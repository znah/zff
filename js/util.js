export function prepareWASM(instance) {
    const type2class = {uint8_t: Uint8Array, int: Int32Array, uint64_t: BigUint64Array};
    const objects = {};
    const prefix = '_len_';
    const exports = instance.exports;
    for (const key in exports) {
        if (!key.startsWith(prefix)) {
            if (!key.startsWith('_')) {
                objects[key] = exports[key];
            }
            continue;
        }
        const [name, type] = key.slice(prefix.length).split('__');
        const ofs = exports['_get_'+name]();
        const len = exports[key]();
        const buf = new (type2class[type])(exports.memory.buffer, ofs, len);
        objects[name] = buf;
    }
    return objects;
}
