#include "common.h"
#include "math.h"

enum {
    SOUP_WIDTH = 200,
    SOUP_HEIGHT = 200,
    TAPE_N = SOUP_WIDTH*SOUP_HEIGHT,
    SOUP_SIZE = TAPE_N*TAPE_LENGTH,
};


BUFFER(soup, uint8_t, SOUP_SIZE)
BUFFER(counts, int, 256)
BUFFER(write_count, int, TAPE_N)
BUFFER(batch_pair_n, int, 1)
BUFFER(batch_idx, int, MAX_BATCH_PAIR_N*2)
BUFFER(batch, uint8_t, MAX_BATCH_PAIR_N*2*TAPE_LENGTH)
BUFFER(batch_write_count, int, MAX_BATCH_PAIR_N*2)
BUFFER(rng_state, uint64_t, 1)

WASM_EXPORT("get_tape_len") int get_tape_len() {return TAPE_LENGTH;}
WASM_EXPORT("get_soup_width") int get_soup_width() {return SOUP_WIDTH;}
WASM_EXPORT("get_soup_height") int get_soup_height() {return SOUP_HEIGHT;}


uint64_t rand64(/*uint64_t seed*/) {
  uint64_t z = (rng_state[0] += 0x9e3779b97f4a7c15);
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9;
  z = (z ^ (z >> 27)) * 0x94d049bb133111eb;
  return z ^ (z >> 31);
}

WASM_EXPORT("init")
void init(int seed) {
    rng_state[0] = seed;
    for (int i=0; i<TAPE_N*TAPE_LENGTH; ++i) {
        soup[i] = rand64();
    }
}

WASM_EXPORT("mutate")
void mutate(int n) {
    for (int i=0; i<n; ++i) {
        uint64_t rnd = rand64();
        uint8_t v = rnd&0xff; rnd >>= 8;
        soup[rnd % SOUP_SIZE] = v;
    }
}

WASM_EXPORT("prepare_batch") int prepare_batch() {
    int pair_n = 0, collision_count=0, pos=0;
    uint8_t mask[TAPE_N] = {0};
    while (pair_n<MAX_BATCH_PAIR_N && collision_count<16) {
        uint64_t rnd = rand64();
        int dir = (rnd&1)*2-1; rnd>>=1;
        int horizontal = rnd&1; rnd>>=1;
        int i = rnd % TAPE_N, j=i;
        if (mask[i]) { ++collision_count; continue;}
        if (horizontal) {
            if (i % SOUP_WIDTH == 0)     { dir =  1; }
            if ((i+1) % SOUP_WIDTH == 0) { dir = -1; }
            j += dir;
        } else {
            if (i < SOUP_WIDTH)          { dir =  1; }
            if (TAPE_N-i-1 < SOUP_WIDTH) { dir = -1; }
            j += dir*SOUP_WIDTH;
        }
        if (mask[j]) { ++collision_count; continue;}
        mask[i] = mask[j] = 1;
        batch_idx[2*pair_n] = i;
        batch_idx[2*pair_n+1] = j;
        for (int k=0; k<TAPE_LENGTH; ++k) {
            batch[pos+k] = soup[i*TAPE_LENGTH+k];
            batch[pos+k+TAPE_LENGTH] = soup[j*TAPE_LENGTH+k];
        }
        pos += TAPE_LENGTH*2;
        pair_n++;
        collision_count = 0;
    }
    batch_pair_n[0] = pair_n;
    return pair_n;
}

WASM_EXPORT("absorb_batch") int absorb_batch() {
    const uint8_t * src = batch;
    const int pair_n = batch_pair_n[0];
    for (int i=0; i<pair_n*2; ++i) {
        const int tape_idx = batch_idx[i];
        uint8_t * dst = soup + tape_idx*TAPE_LENGTH;
        for (int k=0; k<TAPE_LENGTH; ++k,++src,++dst) {
            *dst = *src;
        }
        write_count[tape_idx] = batch_write_count[i];
    }
}

WASM_EXPORT("updateCounts")
void updateCounts() {
    for (int i=0; i<256; ++i) counts[i] = 0;
    for (int i=0; i<SOUP_SIZE; ++i) {
        counts[soup[i]]++;
    }
}