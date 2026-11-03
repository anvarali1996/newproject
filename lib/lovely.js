// Two-phase multi-person video replacement provider.
// This is a separate paid service; Runway Act-Two does NOT provide cast detection.
const API = 'https://lovelyrouter.com/v1/videos/replacements';
export const SWAP_MODEL = 'minimax-h3-aftermidnight';
export const SWAP_RATE = Math.max(1, Math.min(1000, Number(process.env.SWAP_CREDITS_PER_SECOND || 12)));
const validateId = id => {
  if (typeof id !== 'string' || !/^rpl_[a-zA-Z0-9]{12,48}$/.test(id)) throw Error('Invalid video analysis ID');
  return id;
};
export function isCastId(id) { return typeof id === 'string' && /^p[1-9][0-9]*$/.test(id); }

async function request(url, { method='GET', form=null, json=null }={}) {
  if (!process.env.LOVELY_API_KEY) throw Error('Multi-person replacement needs LOVELY_API_KEY. Runway alone cannot detect multiple people.');
  const response = await fetch(url, {
    method,
    headers:{Authorization:`Bearer ${process.env.LOVELY_API_KEY}`,...(json?{'Content-Type':'application/json'}:{})},
    ...(form?{body:form}:json?{body:JSON.stringify(json)}:{}),
    cache:'no-store',signal:AbortSignal.timeout(25000)
  });
  const raw = await response.text();
  let data;try{data=JSON.parse(raw);}catch{data={message:raw.slice(0,240)};}
  if(!response.ok) throw Error(`Video replacement API ${response.status}: ${String(data?.error?.message||data?.message||'Request failed').slice(0,180)}`);
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
    if(!isCastId(id)||typeof url!=='string'||!url.startsWith('https://'))throw Error('Invalid person mapping');
    cast[id]={image:url};
  }
  if(!Object.keys(cast).length||Object.keys(cast).length>4)throw Error('Choose 1–4 people');
  return request(`${API}/${encodeURIComponent(validateId(providerId))}/render`,{
    method:'POST',json:{cast,mode:'face',background:'keep',prompt:'Keep the original timing, poses, motion and environment natural. Match each person to their assigned reference photo. Do not alter unmapped people.'}
  });
}
export function cleanCast(cast){
  return Array.isArray(cast)?cast.filter(x=>isCastId(x.id)).slice(0,4).map(x=>({id:x.id,seconds:x.seconds||0})):[];
}
export function costForSwap(seconds,rate=SWAP_RATE){
  if(!Number.isFinite(seconds)||seconds<2||seconds>10) throw Error('Choose a 2–10 second MP4 for this first version');
  return Math.ceil(seconds)*rate;
}
export async function getFacePreview(providerId,personId){
  if(!isCastId(personId))throw Error('Invalid person ID');
  if(!process.env.LOVELY_API_KEY)throw Error('Missing video provider key');
  const url=`${API}/${encodeURIComponent(validateId(providerId))}/cast/${personId}/face`;
  const res=await fetch(url,{headers:{Authorization:`Bearer ${process.env.LOVELY_API_KEY}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('Could not load face preview');
  const type=res.headers.get('content-type')||'image/jpeg';
  if(!type.startsWith('image/'))throw Error('Unexpected preview format');
  return new Response(res.body,{status:200,headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
