import { packageWebFiles } from '../../assets/zip-upload.js';
export async function projectFixture() {
  const zip = await packageWebFiles([new File(['config_version=5\n[application]\nconfig/name="Test"'], 'project.godot'), new File(['{"targets":[],"meta":{"semver":"3.0.0"}}'], 'project.json')]);
  return { name:'source.zip', mimeType:'application/zip', buffer:Buffer.from(await zip.arrayBuffer()) };
}
export async function attachProject(request, endpoint, id, token) {
  const response = await request.post(`${endpoint}/project-upload`, {headers:{'X-Portal-Session':token},multipart:{submission_id:id,revision:crypto.randomUUID(),project:await projectFixture()}});
  if (!response.ok()) throw new Error(await response.text());
}
