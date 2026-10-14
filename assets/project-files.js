// Project archives are stored as attachments, never extracted or executed here.
export const PROJECT_LIMIT = 500 * 1024 * 1024;
export function validateProjectArchive(bytes, name, engine) {
  const fail = () => { throw new Error('invalid_project'); };
  if (!/\.(zip|sb3)$/i.test(name ?? '') || !bytes.length || bytes.length > PROJECT_LIMIT) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail();
  const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
  if (!count || count > 5000 || start + size !== end) fail();
  const names = new Set(), decoder = new TextDecoder('utf-8', { fatal: true });
  let at = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail();
    const flags = u16(at + 8), method = u16(at + 10), packed = u32(at + 20), unpacked = u32(at + 24);
    const length = u16(at + 28), next = at + 46 + length + u16(at + 30) + u16(at + 32), local = u32(at + 42);
    if (next > end || (flags & 1) || ![0, 8].includes(method) || u16(at + 34) || ((u32(at + 38) >>> 16) & 0xf000) === 0xa000) fail();
    let path; try { path = decoder.decode(bytes.subarray(at + 46, at + 46 + length)); } catch { fail(); }
    if (!path || /[\\\x00-\x1f\x7f:]/.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.') || names.has(path)) fail();
    names.add(path); total += unpacked;
    if (total > 2 * 1024 * 1024 * 1024 || local + 30 > start || u32(local) !== 0x04034b50) fail();
    const data = local + 30 + u16(local + 26) + u16(local + 28);
    if (data + packed > start || u16(local + 8) !== method || u16(local + 6) !== flags || u16(local + 26) !== length) fail();
    for (let i = 0; i < length; i++) if (bytes[local + 30 + i] !== bytes[at + 46 + i]) fail();
    at = next;
  }
  if (at !== end) fail();
  if (/\.sb3$/i.test(name)) { if (engine === 'godot' || !names.has('project.json')) fail(); }
  else if (engine === 'godot' && ![...names].some(path => /(^|\/)project\.godot$/.test(path))) fail();
  else if (engine === 'scratch' && ![...names].some(path => /(^|\/)project\.json$/.test(path) || /\.sb3$/i.test(path))) fail();
  return { count, expandedSize: total };
}
export async function checkProjectFile(file, engine) {
  if (!file || !file.size || file.size > PROJECT_LIMIT) throw new Error('invalid_project');
  return inspectProjectArchive(async (at,length) => new Uint8Array(await file.slice(at,at+length).arrayBuffer()), file.size, file.name, engine);
}
// Read only directory/header ranges. Neither the browser nor Edge buffers a 500MB archive.
export async function inspectProjectArchive(read, size, name, engine) {
  const fail = () => { throw new Error('invalid_project'); };
  if (!Number.isSafeInteger(size) || size < 22 || size > PROJECT_LIMIT || !/\.(zip|sb3)$/i.test(name??'')) fail();
  const tailStart=Math.max(0,size-65557), tail=await read(tailStart,size-tailStart);
  const view = bytes => new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const t=view(tail);let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(t.getUint32(i,true)===0x06054b50&&i+22+t.getUint16(i+20,true)===tail.length){end=i;break;}
  if(end<0||t.getUint16(end+4,true)||t.getUint16(end+6,true)||t.getUint16(end+8,true)!==t.getUint16(end+10,true))fail();
  const count=t.getUint16(end+10,true),start=t.getUint32(end+16,true),length=t.getUint32(end+12,true);
  if(!count||count>5000||length>4*1024*1024||start+length!==tailStart+end)fail();
  const directory=await read(start,length),d=view(directory),decoder=new TextDecoder('utf-8',{fatal:true}),names=new Set(),entries=[];
  let at=0,total=0;
  for(let n=0;n<count;n++){
    if(at+46>length||d.getUint32(at,true)!==0x02014b50)fail();
    const flags=d.getUint16(at+8,true),method=d.getUint16(at+10,true),packed=d.getUint32(at+20,true),unpacked=d.getUint32(at+24,true),nameLength=d.getUint16(at+28,true),local=d.getUint32(at+42,true);
    const next=at+46+nameLength+d.getUint16(at+30,true)+d.getUint16(at+32,true);
    if(next>length||(flags&1)||![0,8].includes(method)||d.getUint16(at+34,true)||((d.getUint32(at+38,true)>>>16)&0xf000)===0xa000||local+30>start)fail();
    const filename=directory.slice(at+46,at+46+nameLength);let path;try{path=decoder.decode(filename);}catch{fail();}
    if(!path||/[\\\x00-\x1f\x7f:]/.test(path)||path.startsWith('/')||path.split('/').some(p=>p==='..'||p==='.')||names.has(path))fail();
    names.add(path);total+=unpacked;if(total>2*1024*1024*1024)fail();
    entries.push({local,filename,flags,method,packed});at=next;
  }
  if(at!==length)fail();
  if(/\.sb3$/i.test(name)){if(engine==='godot'||!names.has('project.json'))fail();}
  else if(engine==='godot'&&![...names].some(p=>/(^|\/)project\.godot$/.test(p)))fail();
  else if(engine==='scratch'&&![...names].some(p=>/(^|\/)project\.json$/.test(p)||/\.sb3$/i.test(p)))fail();
  for(const entry of entries.sort((a,b)=>a.local-b.local)){
    const header=view(await read(entry.local,30));
    if(header.getUint32(0,true)!==0x04034b50||header.getUint16(6,true)!==entry.flags||header.getUint16(8,true)!==entry.method||header.getUint16(26,true)!==entry.filename.length)fail();
    if(entry.local+30+entry.filename.length+header.getUint16(28,true)+entry.packed>start)fail();
    const filename=await read(entry.local+30,entry.filename.length);
    if(filename.some((b,i)=>b!==entry.filename[i]))fail();
  }
  return {count,expandedSize:total};
}
