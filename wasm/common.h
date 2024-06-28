#include <stdint.h>

#ifdef WASM
    #define WASM_EXPORT(name) __attribute__((export_name(name)))
#else
    #define WASM_EXPORT(name)
#endif

#define BUFFER(name, type, size) type name[size]; \
  WASM_EXPORT("_get_"#name) type* get_##name() {return name;} \
  WASM_EXPORT("_len_"#name"__"#type) int get_##name##_len() {return (size);}

enum {
    TAPE_LENGTH = 16, // must be 2 ** N
    MAX_BATCH_PAIR_N = 1024*8
};
