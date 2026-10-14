import { accessToken, deletePrivateZip } from './drive.mjs';
import { inspectProjectArchive, PROJECT_LIMIT } from '../../../assets/project-files.js';
const CHUNK=8*1024*1024;
export function projectTransfer({projectRpc,serviceAccountJson,oauthJson,pendingFolderId,fetcher=fetch}) {
  const credentials={serviceAccountJson,oauthJson,fetcher};
  const auth=async()=>({Authorization:`Bearer ${await accessToken(serviceAccountJson,fetcher,oauthJson)}`});
  const checked=async(action,body)=>{const r=await projectRpc(action,body);if(r?.error)throw new Error(r.error);return r;};
  async function receipt(transfer,response) {
    if(response.status===308){const range=response.headers.get('range');if(range&&!/^bytes=0-\d+$/.test(range))throw new Error('drive_unavailable');return {offset:range?Number(range.split('-')[1])+1:0,file_id:null};}
    if(!response.ok)throw new Error('drive_unavailable');const result=await response.json();
    if(typeof result.id!=='string'||Number(result.size)!==Number(transfer.size))throw new Error('drive_unavailable');
    return {offset:Number(transfer.size),file_id:result.id};
  }
  return async (path,request)=>{
    async function metadata(){
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('invalid_request');
      const reader=request.body?.getReader();if(!reader)throw new Error('invalid_request');const chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new Error('invalid_request');}chunks.push(value);}
      try{const input=JSON.parse(await new Blob(chunks).text());if(!input||Array.isArray(input)||typeof input!=='object')throw new Error();return input;}catch{throw new Error('invalid_request');}
    }
    if(path==='start'){
      const input=await metadata();
      if(!Number.isSafeInteger(input.size)||input.size<1||input.size>PROJECT_LIMIT||typeof input.name!=='string'||input.name.length>180||/[\\/\x00-\x1f\x7f]/.test(input.name)||!/\.(zip|sb3)$/i.test(input.name))throw new Error('invalid_project');
      const prepared=await checked('prepare',input);
      const response=await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,size',{method:'POST',headers:{...await auth(),'Content-Type':'application/json','X-Upload-Content-Type':'application/zip','X-Upload-Content-Length':String(input.size)},body:JSON.stringify({name:`${input.submission_id}-project-${input.revision}.zip`,parents:[pendingFolderId],mimeType:'application/zip'}),signal:AbortSignal.timeout(15000)});
      const location=response.headers.get('location');
      if(!response.ok||!location||!location.startsWith('https://www.googleapis.com/upload/drive/v3/files?'))throw new Error('drive_unavailable');
      await checked('create',{...input,upload_url:location,previous_revision:prepared.previous_revision});
      return {offset:0};
    }
    const input=path==='chunk'?{submission_id:request.headers.get('x-portal-submission'),revision:request.headers.get('x-portal-revision')}:await metadata();
    const transfer=await checked('get',input);
    if(path==='finish'){
      if(!transfer.file_id||Number(transfer.offset)!==Number(transfer.size))throw new Error('conflict');
      const headers=await auth(),windows=new Map();
      const read=async(at,length)=>{
        if(at<0||at+length>Number(transfer.size))throw new Error('invalid_project');
        const result=new Uint8Array(length);let written=0;
        while(written<length){const start=Math.floor((at+written)/(4*1024*1024))*4*1024*1024;
          let bytes=windows.get(start);
          if(!bytes){const end=Math.min(start+4*1024*1024,Number(transfer.size))-1;
            const response=await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(transfer.file_id)}?alt=media&supportsAllDrives=true`,{headers:{...headers,Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(30000)});
            if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${transfer.size}`)throw new Error('drive_unavailable');
            bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==end-start+1)throw new Error('drive_unavailable');
            if(windows.size>=2)windows.delete(windows.keys().next().value);windows.set(start,bytes);
          }
          const offset=at+written-start,count=Math.min(length-written,bytes.length-offset);result.set(bytes.subarray(offset,offset+count),written);written+=count;
        }return result;
      };
      try{await inspectProjectArchive(read,Number(transfer.size),transfer.name,transfer.engine);}
      catch(error){if(error.message==='invalid_project')await deletePrivateZip({...credentials,fileId:transfer.file_id}).catch(()=>{});throw error;}
      return checked('finish',input);
    }
    let response;
    if(path==='status')response=await fetcher(transfer.upload_url,{method:'PUT',headers:{...await auth(),'Content-Range':`bytes */${transfer.size}`,'Content-Length':'0'},body:new Uint8Array(),signal:AbortSignal.timeout(15000)});
    else{
      const offset=Number(request.headers.get('x-portal-offset'));
      if(!Number.isSafeInteger(offset)||offset!==Number(transfer.offset)||offset%262144!==0||offset>=Number(transfer.size))throw new Error('conflict');
      const reader=request.body?.getReader();if(!reader)throw new Error('invalid_project');const chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>CHUNK){await reader.cancel();throw new Error('invalid_project');}chunks.push(value);}
      if(size!==Math.min(CHUNK,Number(transfer.size)-offset))throw new Error('invalid_project');
      const bytes=new Uint8Array(size);let at=0;for(const value of chunks){bytes.set(value,at);at+=value.length;}
      response=await fetcher(transfer.upload_url,{method:'PUT',headers:{...await auth(),'Content-Type':'application/zip','Content-Range':`bytes ${offset}-${offset+size-1}/${transfer.size}`},body:bytes,signal:AbortSignal.timeout(45000)});
    }
    const result=await receipt(transfer,response);await checked('advance',{...input,...result,offset:String(result.offset)});return {offset:result.offset};
  };
}
