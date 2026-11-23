// Tiny stack VM for make.fun's tiny stack ISA v1 (kit: generator/subject/ISA.md,
// generator/subject/vm.mjs is the reference VM). Runs every program of a set
// in one run: reads /input/<id>/program.bin + input.bin, writes
// /output/<id>/stdout.bin + exit.txt. Deterministic; no clock, no network.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const STACK_MAX = 256;
const CALLS_MAX = 64;
const MEMORY_WORDS = 256;
const STEP_LIMIT = 1000000;
const OUTPUT_MAX = 65536;
// Opcode byte to [immediate bytes, values popped, values pushed].
const OP = [];
for (const e of [[0,0,0,0],[1,1,0,1],[2,4,0,1],[3,0,1,0],[4,0,1,2],[5,0,2,2],[6,0,2,3],[7,0,3,3],[16,0,2,1],[17,0,2,1],[18,0,2,1],[19,0,2,1],[20,0,2,1],[21,0,2,1],[22,0,2,1],[23,0,1,1],[24,0,2,1],[25,0,2,1],[26,0,2,1],[27,0,1,1],[28,0,2,1],[29,0,2,1],[30,0,2,1],[32,0,2,1],[33,0,2,1],[34,0,2,1],[48,2,0,0],[49,2,1,0],[50,2,1,0],[51,2,0,0],[52,0,0,0],[64,0,1,1],[65,0,2,0],[80,0,1,0],[81,0,1,0],[82,0,0,1],[83,0,1,0]]) OP[e[0]] = e.slice(1);
const enc = new TextEncoder();
function run(program, input) {
  const n = program.length;
  const D = new Int32Array(STACK_MAX);
  let sp = 0;
  const C = new Int32Array(CALLS_MAX);
  let csp = 0;
  const M = new Int32Array(MEMORY_WORDS);
  const out = new Uint8Array(OUTPUT_MAX);
  let olen = 0;
  let inPos = 0;
  let pc = 0;
  let steps = 0;
  const done = (exit) => ({ stdout: out.slice(0, olen), exit });
  for (;;) {
    if (steps === STEP_LIMIT) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const byte = program[pc];
    const op = OP[byte];
    if (op === undefined) return done(5);
    const imm = op[0];
    if (pc + imm >= n) return done(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < op[1]) return done(2);
    if (sp - op[1] + op[2] > STACK_MAX) return done(3);
    pc = next;
    switch (byte) {
      case 0: return done(0);
      case 1: D[sp++] = (program[next - 1] << 24) >> 24; break;
      case 2: D[sp++] = program[next - 4] | (program[next - 3] << 8) | (program[next - 2] << 16) | (program[next - 1] << 24); break;
      case 3: sp--; break;
      case 4: D[sp] = D[sp - 1]; sp++; break;
      case 5: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 6: D[sp] = D[sp - 2]; sp++; break;
      case 7: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 16: case 17: case 18: case 19: case 20: case 21: case 22:
      case 24: case 25: case 26: case 28: case 29: case 30:
      case 32: case 33: case 34: {
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r;
        switch (byte) {
          case 16: r = (a + b) | 0; break;
          case 17: r = (a - b) | 0; break;
          case 18: r = Math.imul(a, b); break;
          case 19:
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 20:
            if (b === 0) return done(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 21:
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 22:
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 24: r = a & b; break;
          case 25: r = a | b; break;
          case 26: r = a ^ b; break;
          case 28: r = a << (b & 31); break;
          case 29: r = a >> (b & 31); break;
          case 30: r = (a >>> (b & 31)) | 0; break;
          case 32: r = a === b ? 1 : 0; break;
          case 33: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 23: D[sp - 1] = (-D[sp - 1]) | 0; break;
      case 27: D[sp - 1] = ~D[sp - 1]; break;
      case 48: case 49: case 50: {
        const rel = ((program[next - 2] | (program[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (byte !== 48) {
          const v = D[--sp];
          take = byte === 49 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 51:
        if (csp === CALLS_MAX) return done(7);
        C[csp++] = next;
        pc = program[next - 2] | (program[next - 1] << 8);
        break;
      case 52:
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 64: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= MEMORY_WORDS) return done(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 65: {
        const addr = D[sp - 1];
        const v = D[sp - 2];
        if (addr < 0 || addr >= MEMORY_WORDS) return done(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 80: {
        const bytes = enc.encode(String(D[sp - 1]));
        if (olen + bytes.length > OUTPUT_MAX) return done(11);
        sp--;
        out.set(bytes, olen);
        olen += bytes.length;
        break;
      }
      case 81:
        if (olen + 1 > OUTPUT_MAX) return done(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 82: D[sp++] = inPos < input.length ? input[inPos++] : -1; break;
      case 83: return done(D[--sp] & 255);
    }
  }
}
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.stdout);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
