import { config } from './config.js';
import { userSessionKey } from './navigation.js?v=20261009b';
export function gameReport(parent, gameId, title) {
  if (document.getElementById('gameReport') || !config.supabaseUrl) return;
  const box = document.createElement('details'); box.id = 'gameReport'; box.className = 'report-panel';
  const summary = document.createElement('summary'); summary.textContent = 'このゲームを報告'; box.append(summary);
  const target = document.createElement('p'); target.textContent = `対象ゲーム：${title}`;
  const warning = document.createElement('p'); warning.textContent = '氏名、メールアドレス、電話番号、住所などの個人情報は入力しないでください。';
  const form = document.createElement('form');
  const label = document.createElement('label'); label.textContent = '報告理由';
  const category = document.createElement('select'); category.name = 'category'; category.required = true;
  for (const [value,text] of [['','選択してください'],['rights','著作権・権利侵害'],['personal_data','個人情報が含まれている'],['inappropriate','不適切な内容'],['payments','広告・課金への無断誘導'],['network','不審な外部通信'],['other','その他']]) {
    const option = document.createElement('option'); option.value=value; option.textContent=text; category.append(option);
  }
  label.append(category);
  const detailLabel = document.createElement('label'); detailLabel.textContent = '詳細（1000文字以内）';
  const detail = document.createElement('textarea'); detail.name='detail'; detail.required=true; detail.maxLength=1000; detailLabel.append(detail);
  const button=document.createElement('button');button.type='submit';button.textContent='報告を送信';
  const status=document.createElement('p');status.setAttribute('role','status');
  form.append(label,detailLabel,button); box.append(target,warning,form,status);parent.append(box);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity()||button.disabled)return;button.disabled=true;
    try {
      const token=sessionStorage.getItem(userSessionKey);
      const response=await fetch(`${config.supabaseUrl}/functions/v1/portal`,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',...(config.anonKey?{apikey:config.anonKey}:{}),...(token?{'X-Portal-Session':token}:{})},
        body:JSON.stringify({action:'report.create',data:{game_id:gameId,category:category.value,detail:detail.value}}),signal:AbortSignal.timeout(20000)});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error??'unavailable');
      form.hidden=true;status.textContent='報告を受け付けました。個別の回答・結果の通知は行いません。';
    } catch(error){status.textContent=error.message==='rate_limited'?'報告が集中しています。しばらくして再試行してください。':'報告を送信できませんでした。対象や入力を確認して再試行してください。';button.disabled=false;}
  });
}
