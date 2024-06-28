import { prepareWASM } from "./util.js";
import { byte2asm } from "./z80disasm.js";

const $ = q=>document.querySelector(q);

const stat = $('#stat');
const seedInput = $('#seed');
//const ctx = $('#c').getContext('2d');
const glsl = SwissGL($('#c'));

const noiseCoef0 = 1/16;
const thread_n = 4;

let main, z80, tape_len;
const colormap = new Uint8Array(256*4);

const workers = [];
let needReset = true;
let noiseCoef = noiseCoef0;
let pending = 0;
let batch_i = 0;
let opsEMA=0, startTime, batchOps;
let running=true;
let inspectIdx = 0;
let mouseXY = [0,0];

function requestReset() {
    needReset = true;
    console.log('reset');
}
$('#reset').onclick = requestReset;

function playPause() {
    running = !running;
    $('#playPause').innerText = running ? "pause" : "play";
    if (running) {
        scheduleBatch();
    }    
}

$('#playPause').onclick = playPause;

document.addEventListener('keydown', function(event) {
    if (event.key === ' ' || event.code === 'Space') { 
        playPause();
    }
});

const clip = (v,a,b)=>Math.max(a, Math.min(v, b));

$('#c').addEventListener('mousemove', e=>{
    const {width, height} = $('#c');
    const soup_w = main.get_soup_width();
    const soup_h = main.get_soup_height();
    mouseXY = [e.offsetX/width, e.offsetY/height];
    const x = clip(Math.floor(mouseXY[0]*soup_w), 0, soup_w-1);
    const y = clip(Math.floor(mouseXY[1]*soup_h), 0, soup_h-1);
    inspectIdx = y*soup_w+x;
    const p = inspectIdx*16;
    z80.batch.set(main.soup.slice(p, p+32));
    z80.z80_trace(128);
});

function updateNoise() {
    const v = 2**$('#noise').value;
    $('#noiseLabel').innerText = `1/${v}`;
    noiseCoef = 1.0/v;
}
updateNoise();
$('#noise').addEventListener("input", updateNoise);


function scheduleBatch() {
    if (!running || pending) {
        return;
    }
    if (needReset) {
        const seed = parseInt(seedInput.value);
        main.init(seed);
        batch_i = 0;
        needReset = false;
    }
    startTime = Date.now();
    batchOps = 0;
    const pair_n = main.prepare_batch();
    const job_n = pending = workers.length;
    const chunks = Array(job_n).fill(0).map((_,i)=>Math.floor(i*pair_n/job_n));
    chunks.push(pair_n);
    for (let i=0; i<job_n; ++i) {
        const start=chunks[i], end=chunks[i+1];
        workers[i].postMessage({batch:main.batch.slice(start*tape_len*2, end*tape_len*2),
            ofs:start, pair_n:end-start});
    }
}

function onmessage(e) {
    const msg = e.data;
    main.batch.set(msg.batch, msg.ofs*tape_len*2);
    main.batch_write_count.set(msg.write_count, msg.ofs);
    batchOps += msg.totalOps;
    --pending;
    if (pending) {
        return;
    }
    main.absorb_batch();
    const pair_n = main.batch_pair_n[0];
    main.mutate(pair_n*noiseCoef);
    ++batch_i;
    const op_per_sec = batchOps / ((Date.now()-startTime)/1000.0);
    opsEMA = opsEMA*0.99 + 0.01*op_per_sec;
    scheduleBatch();
}

const hex = byte=>byte.toString(16).padStart(2, '0');
const hexColor = (r,g,b)=>`#${hex(r)}${hex(g)}${hex(b)}`;
const colorMatrix = [];
function createMatrix() {
    const matrix = document.getElementById('matrix');
    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
            const square = document.createElement('div');
            square.classList.add('square');
            colorMatrix.push(square);
            const tooltip = document.createElement('span');
            tooltip.classList.add('tooltip');
            const code = i*16+j;
            tooltip.textContent = `0x${hex(code)}: ${byte2asm[code]}`;
            square.appendChild(tooltip);
            matrix.appendChild(square);
            square.addEventListener('click', (event) => openColorPicker(event, code));
        }
    }
}

function openColorPicker(event, code) {
    const colorPicker = document.getElementById('colorPicker');
    const [r,g,b] = colormap.slice(code*4,code*4+3);
    colorPicker.value = hexColor(r,g,b);
    
    const rect = event.target.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    colorPicker.style.left = (rect.left + scrollX) + 'px';
    colorPicker.style.top = (rect.bottom + scrollY + 5) + 'px';
    colorPicker.style.display = 'block';
    colorPicker.oninput = e=>{
        const s = colorPicker.value;
        colorMatrix[code].style.backgroundColor = s;
        const rgb=[1,3,5].map(i=>parseInt(s.slice(i,i+2), 16));
        colormap.set(rgb, code*4);
    }
    
    event.stopPropagation();

    setTimeout(()=>colorPicker.click(), 0);
}
function closeColorPicker() {
    document.getElementById('colorPicker').style.display = 'none';
}
document.addEventListener('click', event=>{
    if (event.target.closest('#colorPicker') === null) {
        closeColorPicker();
    }
});
function updateColormap() {
    for (let i=0; i<256; ++i) {
        const [r,g,b] = colormap.slice(i*4,i*4+3);
        colorMatrix[i].style.backgroundColor = hexColor(r,g,b);
    }

}
createMatrix();

function frame() {
    if (!main) {
        requestAnimationFrame(frame);
        return;
    }
    const w = main.get_soup_width();
    const h = main.get_soup_height();
    const soup = glsl({}, {data:main.soup, size:[w*16, h], format:'r8', tag:'soup'});
    const cmap = glsl({}, {data:colormap, size:[256, 1], tag:'cmap'});
    const soup2d = glsl({soup, cmap, FP:`
        const int TapeLen=16, Tile=4;
        ivec2 tapeXY=I/Tile, xy=I%Tile;
        int ofs = xy.y*Tile+xy.x;
        float v = soup(ivec2(tapeXY.x*TapeLen+ofs, tapeXY.y)).r;
        FOut = cmap(vec2(v,0));
    `}, {size:[w*4, h*4], tag:'soup2d'});
    const soup2dAvg = glsl({soup2d, FP:`
        const int Tile=4;
        vec4 acc = vec4(0);
        for (int y=0; y<Tile; ++y)
        for (int x=0; x<Tile; ++x) {
            vec4 c = soup2d(I*Tile+ivec2(x, y));
            acc += c*c;
        }
        FOut = sqrt(acc / float(Tile*Tile));
    `}, {size:[w, h], tag:'soup2dAvg'});    
    glsl({tex:soup2dAvg, FP:`tex(vec2(UV.x,1.0-UV.y))`});
    const trace = glsl({}, {data:z80.trace_vis, size:[tape_len*2, 128], tag:'trace'});
    glsl({trace, Blend:'d*(1-sa)+s*sa',
        VP:`XY*vec2(1./8.,-0.5)-vec2(0.8, 0.4),0,1`,
        FP:`trace(UV).rgb,0.7`});
    
    main.updateCounts();
    const writes = main.write_count.reduce((a,b)=>a+b, 0);
    const lines = [`batch_i: ${batch_i}\nwrites: ${writes}\nop/s: ${(opsEMA/1e6).toFixed(2)}M\n`]
    lines.push('Top codes (count, byte, asm):')
    const count_byte = Array.from(main.counts).map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]);
    for (const [count, byte] of count_byte.slice(0,20)) {
        lines.push(`${count.toString().padStart(8)}  ${hex(byte)}  ${byte2asm[byte]}`)
    }
    lines.push('\nselected cell:');
    for (let i=0; i<16; ++i) {
        const byte = main.soup[inspectIdx*tape_len+i];
        lines.push(`  ${hex(i)}  ${hex(byte)}  ${byte2asm[byte]}`)
    }
    stat.innerText = lines.join('\n');
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

for (let i=0; i<thread_n; ++i) {
    const worker = new Worker("js/worker.js", { type: "module" });
    worker.onmessage = onmessage;
    workers.push(worker);
}

function set_color(i, r, g, b) {
    colormap.set([r,g,b,255], i*4);
}

async function run() {
    const mainWasm = await WebAssembly.instantiateStreaming(fetch('wasm/main.wasm'));
    const z80Wasm = await WebAssembly.instantiateStreaming(fetch('wasm/z80worker.wasm'));
    self.main = main = prepareWASM(mainWasm.instance);
    self.z80 = z80 = prepareWASM(z80Wasm.instance);

    for (let i=0; i<256; ++i) {
        let v = 64+i/8;//128+i/4;
        set_color(i, v, v, v);
    }
    set_color(0x00, 0, 0, 0); // nop
    set_color(0x01, 250, 100, 100); // ld bc,nn 
    set_color(0x11, 100, 250, 100); // ld de,nn 
    set_color(0x21, 100, 100, 250); // ld hl,nn

    set_color(0x2a, 255, 255, 255); // ld hl,(nn)

    set_color(0xc5, 240, 200, 200); // push bc
    set_color(0xd5, 240, 240, 200); // push de
    set_color(0xe5, 240, 200, 240); // push hl

    set_color(0xed, 240, 50, 50); // ED
    set_color(0xb0, 240, 60, 60); // [ED] ldir
    set_color(0xb8, 240, 70, 70); // [ED] lddr

    set_color(0xe3, 200, 240, 50); // ex (sp,hl)
    set_color(0xd8, 100, 100, 50); // ret c
    set_color(0xc9, 100, 100, 50); // ret
    
    updateColormap();

    tape_len = main.get_tape_len();
    scheduleBatch();
}
run();

const cmap_jyrki = [
    0xfff, 0xff0, 0xff0, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000,
    0x111, 0xff1, 0xff1, 0x010, 0x010, 0x010, 0x111, 0x111, 0xf1f, 0x111, 0x111, 0x111, 0x111, 0x111, 0x111, 0x111,
    0xf2f, 0xff2, 0xff2, 0x020, 0x020, 0x020, 0x222, 0x222, 0xf2f, 0x222, 0x222, 0x222, 0x222, 0x222, 0x222, 0x222,
    0xf3f, 0xff3, 0xff3, 0x030, 0x030, 0x030, 0x333, 0x333, 0xf3f, 0x333, 0x333, 0x333, 0x333, 0x333, 0x333, 0x333,
    0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4, 0xff4,
    0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5, 0xff5,
    0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6, 0xff6,
    0xff7, 0xff7, 0xff7, 0xff7, 0xff7, 0xff7, 0xf00, 0xff7, 0xff7, 0xff7, 0xff7, 0xff7, 0xff7, 0xff7, 0xff7, 0xff7,
    0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f, 0x88f,
    0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f, 0x99f,
    0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf, 0xaaf,
    0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0xbbf, 0x00f, 0xbbf, 0xbbf, 0xbbf,
    0x0fc, 0xc4c, 0x9cc, 0x46c, 0xc8c, 0x001, 0xccf, 0x6cc, 0x0c6, 0x0cc, 0x8cc, 0xccc, 0xc8c, 0xccc, 0xccf, 0xccc,
    0x0fd, 0xd4c, 0x9dd, 0x46d, 0xd8d, 0x002, 0xddf, 0x6dd, 0x0d6, 0xfdd, 0x8dd, 0xddd, 0xd8d, 0x0ff, 0xddf, 0xddd,
    0x0fe, 0xe4c, 0x9ee, 0x46e, 0xe8e, 0x003, 0xeef, 0x6ee, 0x0e6, 0x8ee, 0x8ee, 0xeee, 0xe8e, 0xff0, 0xeef, 0xeee,
    0x0ff, 0xf4c, 0x9ff, 0x46f, 0xf8f, 0x004, 0xfff, 0x6ff, 0x0f6, 0x8ff, 0x8ff, 0xfff, 0xf8f, 0xf0f, 0xfff, 0xfff];
