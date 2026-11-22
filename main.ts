#!/usr/bin/env node
// tiny stack ISA batch runner for the make.fun entry
// processes each task against the local interpreter
// outputs PASS/FAIL line per task
const fs = require('node:fs');
const path = require('node:path');

const inDir = process.env.MAKEFUN_INPUT_DIR  || '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function to32(x) { return x | 0; }
function u32(x) { let v = x >>> 0; return v; }

function vmRun(program, inputBytes) {
  // constants
  const STACK_MAX = 256;
  const CALL_MAX = 64;
  const MEM_SIZE = 256;
  const OUT_MAX = 65536;
  const MAX_STEPS = 1000000;

  const stack = new Int32Array(STACK_MAX + 1); // allow overflow detection slot
  let sp = 0; // next free index
  const callStack = new Int32Array(CALL_MAX);
  let csp = 0;

  const mem = new Int32Array(MEM_SIZE);
  let pc = 0;
  let inIdx = 0;
  const outChunks = [];
  let outLen = 0;

  function fail(code) {
    return { code, out: concatOut(outChunks, outLen) };
  }
  function push(v) {
    if (sp >= STACK_MAX + 1) return 3; // overflow (allow one extra then trap)
    stack[sp++] = to32(v);
    return 0;
  }
  function pop() {
    if (sp < 1) return { trap: 2, val: 0 };
    return { trap: 0, val: stack[--sp] };
  }
  function pop2() {
    if (sp < 2) return { trap: 2, v1: 0, v2: 0 };
    const a = stack[sp - 2];
    const b = stack[sp - 1];
    sp -= 2;
    return { trap: 0, v1: a, v2: b };
  }
  function emit(s) {
    const b = (typeof s === 'string') ? Buffer.from(s, 'utf8') : s;
    if (outLen + b.length > OUT_MAX) return 11;
    outChunks.push(b);
    outLen += b.length;
    return 0;
  }

  let len = program.length;
  let steps = 0;

  while (true) {
    // step limit
    if (steps >= MAX_STEPS) return fail(10);
    // pc bounds
    if (pc < 0 || pc >= len) return fail(9);
    steps++;
    const op = program[pc];
    pc++;
    const need = (op === 0x01) ? 1 : (op === 0x02) ? 4 : (op >= 0x30 && op <= 0x33) ? 2 : 0;
    if (pc + need > len) return fail(9);
    let t;

    switch (op) {
      case 0x00:
        return { code: 0, out: concatOut(outChunks, outLen) };
      case 0x01: {
        t = program[pc]; pc += 1;
        const sign = (t & 0x80) ? -1 : 0;
        t = t | (sign << 8);
        const r = push(t); if (r) return fail(r);
        break;
      }
      case 0x02: {
        t = program[pc] | (program[pc+1]<<8) | (program[pc+2]<<16) | (program[pc+3]<<24);
        pc += 4;
        const r = push(t); if (r) return fail(r);
        break;
      }
      case 0x03: { const r = pop(); if (r.trap) return fail(r.trap); break; }
      case 0x04: {
        const r = pop(); if (r.trap) return fail(r.trap);
        const p1 = push(r.val); if (p1) return fail(p1);
        const p2 = push(r.val); if (p2) return fail(p2);
        break;
      }
      case 0x05: {
        if (sp < 2) return fail(2);
        const a = stack[sp-1]; const b = stack[sp-2];
        stack[sp-1] = b; stack[sp-2] = a;
        break;
      }
      case 0x06: {
        if (sp < 2) return fail(2);
        const p = push(stack[sp-2]); if (p) return fail(p);
        break;
      }
      case 0x07: {
        if (sp < 3) return fail(2);
        const v1 = stack[sp-3]; const v2 = stack[sp-2]; const v3 = stack[sp-1];
        sp -= 3;
        const p1 = push(v2); if (p1) return fail(p1);
        const p2 = push(v3); if (p2) return fail(p2);
        const p3 = push(v1); if (p3) return fail(p3);
        break;
      }
      case 0x10: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const p = push(r.v1 + r.v2); if (p) return fail(p);
        break;
      }
      case 0x11: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const p = push(r.v1 - r.v2); if (p) return fail(p);
        break;
      }
      case 0x12: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const prod = Number((BigInt(u32(r.v1)) * BigInt(u32(r.v2))) & 0xFFFFFFFFn);
        const p = push(to32(prod)); if (p) return fail(p);
        break;
      }
      case 0x13: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const a = r.v1; const b = r.v2;
        if (b === 0) return fail(4);
        if (a === -2147483648 && b === -1) { const p = push(-2147483648); if (p) return fail(p); break; }
        const q = Math.trunc(a / b);
        const p = push(to32(q)); if (p) return fail(p);
        break;
      }
      case 0x14: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const a = r.v1; const b = r.v2;
        if (b === 0) return fail(4);
        let m;
        if (b === -1) m = 0; else m = a - Math.trunc(a / b) * b;
        const p = push(to32(m)); if (p) return fail(p);
        break;
      }
      case 0x15: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const b = r.v2;
        if (u32(b) === 0) return fail(4);
        const q = Math.trunc(u32(r.v1) / u32(b));
        const p = push(to32(q)); if (p) return fail(p);
        break;
      }
      case 0x16: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const b = r.v2;
        if (u32(b) === 0) return fail(4);
        const m = u32(r.v1) % u32(b);
        const p = push(to32(m)); if (p) return fail(p);
        break;
      }
      case 0x17: { const r = pop(); if (r.trap) return fail(r.trap); const p = push(-r.val); if (p) return fail(p); break; }
      case 0x18: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(r.v1 & r.v2); if (p) return fail(p); break; }
      case 0x19: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(r.v1 | r.v2); if (p) return fail(p); break; }
      case 0x1A: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(r.v1 ^ r.v2); if (p) return fail(p); break; }
      case 0x1B: { const r = pop(); if (r.trap) return fail(r.trap); const p = push(~r.val); if (p) return fail(p); break; }
      case 0x1C: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(to32(u32(r.v1) << (r.v2 & 31))); if (p) return fail(p); break; }
      case 0x1D: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(to32(r.v1 >> (r.v2 & 31))); if (p) return fail(p); break; }
      case 0x1E: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(to32(u32(r.v1) >>> (r.v2 & 31))); if (p) return fail(p); break; }
      case 0x20: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(r.v1 === r.v2 ? 1 : 0); if (p) return fail(p); break; }
      case 0x21: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(r.v1 < r.v2 ? 1 : 0); if (p) return fail(p); break; }
      case 0x22: { const r = pop2(); if (r.trap) return fail(r.trap); const p = push(u32(r.v1) < u32(r.v2) ? 1 : 0); if (p) return fail(p); break; }

      case 0x30: { t = program[pc] | program[pc+1]<<8; if (t & 0x8000) t -= 65536; pc += 2 + t; break; }
      case 0x31: {
        const r = pop(); if (r.trap) return fail(r.trap);
        if (r.val === 0) { t = program[pc] | program[pc+1]<<8; if (t & 0x8000) t -= 65536; pc += 2 + t; } else pc += 2;
        break;
      }
      case 0x32: {
        const r = pop(); if (r.trap) return fail(r.trap);
        if (r.val !== 0) { t = program[pc] | program[pc+1]<<8; if (t & 0x8000) t -= 65536; pc += 2 + t; } else pc += 2;
        break;
      }
      case 0x33: {
        if (csp >= CALL_MAX) return fail(7);
        t = program[pc] | program[pc+1]<<8; pc += 2;
        callStack[csp++] = pc;
        pc = t;
        break;
      }
      case 0x34: {
        if (csp < 1) return fail(8);
        pc = callStack[--csp];
        break;
      }
      case 0x40: {
        const r = pop(); if (r.trap) return fail(r.trap);
        const a = u32(r.val);
        if (a >= MEM_SIZE) return fail(6);
        const p = push(mem[a]); if (p) return fail(p);
        break;
      }
      case 0x41: {
        const r = pop2(); if (r.trap) return fail(r.trap);
        const v = r.v1; const a = u32(r.v2);
        if (a >= MEM_SIZE) return fail(6);
        mem[a] = to32(v);
        break;
      }
      case 0x50: {
        const r = pop(); if (r.trap) return fail(r.trap);
        const s = String(r.val);
        const e = emit(s); if (e) return fail(e);
        break;
      }
      case 0x51: {
        const r = pop(); if (r.trap) return fail(r.trap);
        const e = emit(Buffer.from([r.val & 255])); if (e) return fail(e);
        break;
      }
      case 0x52: {
        const b = (inIdx < inputBytes.length) ? inputBytes[inIdx++] : -1;
        const p = push(b); if (p) return fail(p);
        break;
      }
      case 0x53: {
        const r = pop(); if (r.trap) return fail(r.trap);
        return { code: r.val & 255, out: concatOut(outChunks, outLen) };
      }
      default:
        return fail(5);
    }
  }
}

function concatOut(parts) {
  if (!parts.length) return Buffer.alloc(0);
  return Buffer.concat(parts);
}

function main() {
  const ids = fs.readdirSync(inDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  for (const id of ids) {
    const pFile = path.join(inDir, id, 'program.bin');
    const iFile = path.join(inDir, id, 'input.bin');
    const outSub = path.join(outDir, id);
    fs.mkdirSync(outSub, { recursive: true });
    const program = fs.readFileSync(pFile);
    const input = fs.existsSync(iFile) ? fs.readFileSync(iFile) : Buffer.alloc(0);
    const res = vmRun(program, input);
    fs.writeFileSync(path.join(outSub, 'stdout.bin'), res.out);
    fs.writeFileSync(path.join(outSub, 'exit.txt'), String(res.code));
  }
}

main();
