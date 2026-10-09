import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadArchive } from '../assets/game-download.js';
test('download reports actual received bytes with and without a total',async()=>{
 for(const headers of [{},{'content-length':'5'}]) {
  const updates=[];const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3,4,5]));controller.close();}}),{headers});
  assert.deepEqual([...new Uint8Array(await downloadArchive(response,(...args)=>updates.push(args)))],[1,2,3,4,5]);
  assert.deepEqual(updates,[[2,headers['content-length']?5:null],[5,headers['content-length']?5:null]]);
 }
});
test('download enforces the package limit for both declared and streamed sizes',async()=>{
 await assert.rejects(downloadArchive(new Response('x',{headers:{'content-length':String(50*1048576+1)}})),/invalid_preview/);
 let cancelled=false;
 await assert.rejects(downloadArchive(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(50*1048576+1));},cancel(){cancelled=true;}}))),/invalid_preview/);
 assert.equal(cancelled,true);
});
