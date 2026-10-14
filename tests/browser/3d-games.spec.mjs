import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { packageWebFiles } from '../../assets/zip-upload.js';
test.use({launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
async function routes(context, zip) {
 await context.route('**/assets/config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const config={supabaseUrl:"http://127.0.0.1:54321",anonKey:""};'}));
 await context.addInitScript(()=>localStorage.setItem('game-portal.terms.acceptance.v1',JSON.stringify({version:'2026-10-08',acceptedAt:new Date().toISOString()})));
 await context.route('**/functions/v1/portal/public-game',route=>route.fulfill({json:{game:{slug:'8'.repeat(36),title:'3D verification',engine:'godot',description:'3D input test'}}}));
 await context.route('**/functions/v1/portal/public-package',route=>route.fulfill({contentType:'application/zip',body:zip}));
 await context.route('**/functions/v1/portal',route=>route.request().postDataJSON().action==='social.game'
  ?route.fulfill({json:{creator:'3D verification author',like_count:0,liked:false,followed:false,self:false}}):route.continue());
}
test('WebGL2 3D rendering and mouse capture work without granting portal origin access',async({page,context})=>{
 const html=`<!doctype html><html><body><canvas width="320" height="240"></canvas><script>
 const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2');
 if(gl){const shader=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);return shader;};
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'#version 300 es\\n in vec3 position; void main(){gl_Position=vec4(position.xy/(2.0-position.z),0.0,1.0);}'));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'#version 300 es\\n precision mediump float;out vec4 color;void main(){color=vec4(0.1,0.8,0.5,1.0);}'));gl.linkProgram(program);gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,-1,0,0,1,0.7]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,3);
 const pixel=new Uint8Array(4);gl.readPixels(160,120,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);document.body.dataset.rendered=String(pixel[1]>100);}
 canvas.onclick=()=>canvas.requestPointerLock();
 document.addEventListener('pointerlockchange',()=>document.body.dataset.locked=String(document.pointerLockElement===canvas));
 try{parent.document.body.dataset.compromised='true'}catch{document.body.dataset.isolated='true'}
 </script></body></html>`;
 const zip=await packageWebFiles([new File([html],'index.html')]);await routes(context,Buffer.from(await zip.arrayBuffer()));
 await page.goto('game.html?slug='+'8'.repeat(36));
 const frame=page.frameLocator('#gameFrame');await expect(frame.locator('body')).toHaveAttribute('data-rendered','true');await expect(frame.locator('body')).toHaveAttribute('data-isolated','true');
 await frame.locator('canvas').click();await expect(frame.locator('body')).toHaveAttribute('data-locked','true');
 await frame.locator('body').evaluate(()=>document.exitPointerLock());await expect(frame.locator('body')).toHaveAttribute('data-locked','false');
 await expect(page.locator('#gameFrame')).toHaveAttribute('sandbox','allow-scripts allow-pointer-lock');
 expect(await frame.locator('body').evaluate(()=>{try{sessionStorage.getItem('game-portal.user.session.v1');return false;}catch{return true;}})).toBe(true);
 expect(await page.locator('body').getAttribute('data-compromised')).toBeNull();
 expect(await page.evaluate(async()=>{const {mountPrivatePreview}=await import('./assets/private-preview.js');const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts allow-same-origin');try{await mountPrivatePreview(frame,new Map());return false;}catch(error){return error.message==='invalid_preview';}})).toBe(true);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/3d-webgl-player.png',fullPage:true});
});
test('Godot exported 3D scene starts, renders and captures mouse in the real isolated player',async({page,context})=>{
 test.skip(!process.env.GODOT_3D_WEB_ZIP,'Local Godot export is supplied through GODOT_3D_WEB_ZIP');
 await routes(context,await readFile(process.env.GODOT_3D_WEB_ZIP));await page.goto('game.html?slug='+'8'.repeat(36));
 const frame=page.frameLocator('#gameFrame');await expect(frame.locator('body')).toHaveAttribute('data-portal-3d','ready',{timeout:45000});
 await frame.locator('#canvas').click();await expect.poll(()=>frame.locator('body').evaluate(()=>Boolean(document.pointerLockElement))).toBe(true);
 await page.keyboard.press('Escape');await expect.poll(()=>frame.locator('body').evaluate(()=>Boolean(document.pointerLockElement))).toBe(false);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/godot-3d-player.png',fullPage:true});
});
