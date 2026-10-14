import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectProjectArchive, PROJECT_LIMIT } from '../assets/project-files.js';
test('500MB limit is inclusive and archive inspection reads only headers and directory',async()=>{
 const name=Buffer.from('project.godot'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22),size=PROJECT_LIMIT;
 const bodySize=size-local.length-name.length-central.length-name.length-end.length,start=local.length+name.length+bodySize;
 local.writeUInt32LE(0x04034b50);local.writeUInt32LE(bodySize,18);local.writeUInt32LE(bodySize,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt32LE(bodySize,20);central.writeUInt32LE(bodySize,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(start,16);
 const pieces=[[0,local],[30,name],[start,central],[start+46,name],[size-22,end]];let readBytes=0;
 const reader=async(at,length)=>{readBytes+=length;const bytes=new Uint8Array(length);for(const [offset,part] of pieces){const lo=Math.max(at,offset),hi=Math.min(at+length,offset+part.length);if(hi>lo)bytes.set(part.subarray(lo-offset,hi-offset),lo-at);}return bytes;};
 assert.equal((await inspectProjectArchive(reader,size,'source.zip','godot')).count,1);assert.ok(readBytes<70000);
 await assert.rejects(inspectProjectArchive(reader,size+1,'source.zip','godot'),/invalid_project/);
});
