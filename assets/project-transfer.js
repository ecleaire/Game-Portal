export async function sendLargeProject(file,id,{base,headers,onProgress=()=>{},revision=crypto.randomUUID(),fetcher=fetch}) {
  const data={submission_id:id,revision};
  async function json(path,extra={}){const response=await fetcher(`${base}/project-${path}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...data,...extra}),signal:AbortSignal.timeout(path==='finish'?180000:60000)});const result=await response.json();if(!response.ok||result.error)throw new Error(result.error??'unavailable');return result;}
  let {offset}=await json('start',{name:file.name,size:file.size});
  while(offset<file.size){let result;
    for(let attempt=0;attempt<3;attempt++){
      try{const response=await fetcher(`${base}/project-chunk`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Portal-Submission':id,'X-Portal-Revision':revision,'X-Portal-Offset':String(offset)},body:file.slice(offset,Math.min(offset+8*1024*1024,file.size)),signal:AbortSignal.timeout(60000)});result=await response.json();if(!response.ok||result.error)throw new Error(result.error??'unavailable');break;}
      catch(error){if(['unauthorized','forbidden','not_found','invalid_project'].includes(error.message))throw error;result=await json('status');if(result.offset>offset)break;if(attempt===2)throw error;}
    }
    if(!Number.isSafeInteger(result.offset)||result.offset<=offset||result.offset>file.size)throw new Error('upload_response');offset=result.offset;onProgress(Math.round(offset/file.size*100));
  }
  return json('finish');
}
