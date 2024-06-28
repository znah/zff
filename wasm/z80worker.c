#include "../external/z80.h"

#include "common.h"

#ifdef WASM
FILE * const stderr=NULL;
int fprintf(FILE *stream, const char *format, ...) {return 0;}
#endif

enum { PAIR_LENGTH = TAPE_LENGTH * 2 };

BUFFER(batch, uint8_t, MAX_BATCH_PAIR_N * PAIR_LENGTH);
BUFFER(write_count, int, MAX_BATCH_PAIR_N);

typedef struct context_t context_t;
struct context_t {
    uint8_t * pair;
    int pair_idx;
};

uint8_t memoryRead(void * arg, uint16_t ofs) {
    const context_t * ctx = (const context_t *)arg;
    return ctx->pair[ofs & (PAIR_LENGTH-1)];
}
void memoryWrite(void * arg, uint16_t ofs, uint8_t value) {
    const context_t * ctx = (const context_t *)arg;
    ofs &= (PAIR_LENGTH-1);
    ctx->pair[ofs] = value;
    int tape_idx = ctx->pair_idx*2 + (ofs > TAPE_LENGTH);
    write_count[tape_idx]++;
}
uint8_t inPort(z80* cpu, uint8_t port) { return 0; }
void outPort(z80* cpu, uint8_t port, uint8_t value) {}

WASM_EXPORT("run") int run(int pair_n, int step_n) {
    context_t ctx;
    z80 cpu;
    int totalOps = 0;
    for (int i=0; i<pair_n; ++i) {
        write_count[i*2] = 0;
        write_count[i*2+1] = 0;
        ctx.pair = batch + PAIR_LENGTH*i;
        ctx.pair_idx = i;
        z80_init(&cpu);
        cpu.read_byte = memoryRead;
        cpu.write_byte = memoryWrite;
        cpu.userdata = &ctx;
        cpu.port_in = inPort;
        cpu.port_out = outPort;
        int i=0;
        for (; i<step_n && !cpu.halted; ++i) {
            z80_step(&cpu);
        }
        totalOps += i;
    }
    return totalOps;
}


enum{ MAX_STEP_N = 128 };

int trace_step;
BUFFER(z80_state, uint8_t, sizeof(z80));
BUFFER(trace_vis, uint8_t, PAIR_LENGTH*MAX_STEP_N*4);

uint8_t traceRead(void * arg, uint16_t ofs) {
    ofs &= PAIR_LENGTH-1;
    trace_vis[(PAIR_LENGTH*trace_step + ofs)*4 + 1] = 255;
    return batch[ofs];
}
void traceWrite(void * arg, uint16_t ofs, uint8_t value) {
    ofs &= PAIR_LENGTH-1;
    trace_vis[(PAIR_LENGTH*trace_step + ofs)*4] = 255;
    batch[ofs] = value;
}

WASM_EXPORT("z80_trace") void _z80_trace(int step_n) {
    z80 * cpu = (z80*)z80_state;
    z80_init(cpu);    
    cpu->port_in = inPort;
    cpu->port_out = outPort;
    cpu->read_byte = traceRead;
    cpu->write_byte = traceWrite;
    for (int i=0; i<PAIR_LENGTH*MAX_STEP_N*4; ++i) {
        trace_vis[i] = ((i&3) == 3) ? 255 : 0;//i&3 == 0 ? 255 : 0;
    }
    for (trace_step=0; trace_step<step_n; ++trace_step) {
        z80_step(cpu);    
    }
}
