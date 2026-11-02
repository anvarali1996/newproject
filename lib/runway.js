const API='https://api.dev.runwayml.com/v1';
export async function runway(endpoint,method='GET',body) {
  if (!process.env.RUNWAY_API_KEY) throw new Error('Missing RUNWAY_API_KEY');
  const res = await fetch(`${API}${endpoint}`,{
    method,headers:{Authorization:`Bearer ${process.env.RUNWAY_API_KEY}`,'X-Runway-Version':'2024-11-06',
      ...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(25000),
    cache:'no-store'
  });
  const text = await res.text();
  let data;try {data=JSON.parse(text);}catch{data={message:text.slice(0,300)};}
  if (!res.ok) throw new Error(`Runway ${res.status}: ${JSON.stringify(data).slice(0,350)}`);
  return data;
}
export async function createVideo(mode, sourceUri, prompt, { seconds=5, performanceUri=null }={}) {
  if(mode==='image') return runway('/image_to_video','POST',{
    model:'gen4_turbo',promptImage:sourceUri,promptText:prompt,ratio:'720:1280',duration:seconds
  });
  if(mode==='video') return runway('/video_to_video','POST',{
    model:'aleph2',videoUri:sourceUri,promptText:prompt
  });
  if(mode==='act'&&performanceUri) return runway('/character_performance','POST',{
    model:'act_two',
    character:{type:'image',uri:sourceUri},
    reference:{type:'video',uri:performanceUri},
    bodyControl:true,expressionIntensity:3,ratio:'720:1280'
  });
  throw new Error('Unsupported mode');
}
