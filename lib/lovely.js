// Two-phase multi-person video replacement provider.
// This is a separate paid service; Runway Act-Two does NOT provide cast detection.
import { HttpError, badRequest, providerError, providerUnreachable } from './errors.js';

const API = 'https://lovelyrouter.com/v1/videos/replacements';
export const SWAP_MODEL = 'minimax-h3-aftermidnight';
export const SWAP_RATE = Math.max(1, Math.min(1000, Number(process.env.SWAP_CREDITS_PER_SECOND || 12)));
const validateId = id => {
  if (typeof id !== 'string' || !/^rpl_[a-zA-Z0-9]{12,48}$/.test(id)) throw badRequest('Invalid video analysis ID');
  return id;
};
export function isCastId(id) { return typeof id === 'string' && /^p[1-9][0-9]*$/.test(id); }

async function request(url, { method='GET', form=null, json=null }={}) {
  // Runway alone cannot detect multiple people; this workflow needs LOVELY_API_KEY.
  if (!process.env.LOVELY_API_KEY) throw new HttpError(503, 'Multi-person replacement is not enabled yet.');
  let response;
  try {
    response = await fetch(url, {
      method,
      headers:{Authorization:`Bearer ${process.env.LOVELY_API_KEY}`,...(json?{'Content-Type':'application/json'}:{})},
      ...(form?{body:form}:json?{body:JSON.stringify(json)}:{}),
      cache:'no-store',signal:AbortSignal.timeout(25000)
    });
  } catch (error) { throw providerUnreachable('Video replacement service', error); }
  const raw = await response.text();
  let data;try{data=JSON.parse(raw);}catch{data={message:raw.slice(0,240)};}
  if(!response.ok) throw providerError('Video replacement service', response.status, data);
  return data;
}

export async function analyzeVideo(videoUrl){
  const form = new FormData();
  form.set('model',SWAP_MODEL);
  form.set('video',videoUrl);
  form.set('consent','true');
  return request(API,{method:'POST',form});
}
export async function getReplacement(providerId){
  return request(`${API}/${encodeURIComponent(validateId(providerId))}`);
}
export async function renderReplacement(providerId, images){
  const cast={};
  for(const [id,url] of Object.entries(images)){
    if(!isCastId(id)||typeof url!=='string'||!url.startsWith('https://'))throw badRequest('Invalid person mapping');
    cast[id]={image:url};
  }
  if(!Object.keys(cast).length||Object.keys(cast).length>4)throw badRequest('Choose 1–4 people');
  return request(`${API}/${encodeURIComponent(validateId(providerId))}/render`,{
    method:'POST',json:{cast,mode:'face',background:'keep',prompt:'Keep the original timing, poses, motion and environment natural. Match each person to their assigned reference photo. Do not alter unmapped people.'}
  });
}
export function cleanCast(cast){
  return Array.isArray(cast)?cast.filter(x=>isCastId(x?.id)).slice(0,4).map(x=>({id:x.id,seconds:x.seconds||0})):[];
}
export function costForSwap(seconds,rate=SWAP_RATE){
  if(!Number.isFinite(seconds)||seconds<2||seconds>10) throw badRequest('Choose a 2–10 second MP4 for this first version');
  return Math.ceil(seconds)*rate;
}
export async function getFacePreview(providerId,personId){
  if(!isCastId(personId))throw badRequest('Invalid person ID');
  if(!process.env.LOVELY_API_KEY)throw new HttpError(503,'Multi-person replacement is not enabled yet.');
  const url=`${API}/${encodeURIComponent(validateId(providerId))}/cast/${personId}/face`;
  const res=await fetch(url,{headers:{Authorization:`Bearer ${process.env.LOVELY_API_KEY}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new HttpError(502,'Could not load face preview');
  const type=res.headers.get('content-type')||'image/jpeg';
  if(!type.startsWith('image/'))throw Error('Unexpected preview format');
  return new Response(res.body,{status:200,headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
