// Inspect actual uploaded MP4 bytes on the server; do not trust browser-reported duration.
// Supports standard ISO-BMFF (MP4) mvhd, including moov after mdat.
export function mp4Duration(data) {
  const buf=Buffer.from(data);
  function scan(start,end,lookingForMoov=false){
    let pos=start;
    while(pos+8<=end){
      let size=buf.readUInt32BE(pos);
      const type=buf.toString('ascii',pos+4,pos+8);
      let head=8;
      if(size===1){if(pos+16>end)return null;const n=buf.readBigUInt64BE(pos+8);if(n>BigInt(Number.MAX_SAFE_INTEGER))return null;size=Number(n);head=16;}
      if(size===0)size=end-pos;
      if(size<head || pos+size>end)return null;
      if(type==='moov')return scan(pos+head,pos+size,true);
      if(lookingForMoov&&type==='mvhd'){
        const s=pos+head; if(s+20>pos+size)return null;
        const version=buf[s];
        let timescale,duration;
        if(version===0){timescale=buf.readUInt32BE(s+12);duration=buf.readUInt32BE(s+16);}
        else if(version===1&&s+32<=pos+size){timescale=buf.readUInt32BE(s+20);duration=Number(buf.readBigUInt64BE(s+24));}
        else return null;
        if(timescale>0 && Number.isFinite(duration))return duration/timescale;
      }
      pos+=size;
    }
    return null;
  }
  const seconds=scan(0,buf.length);
  if(!seconds || !Number.isFinite(seconds) || seconds<=0)throw Error('Could not read MP4 duration. Export the video as a standard MP4.');
  return seconds;
}
