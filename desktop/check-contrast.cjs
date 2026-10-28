const fs=require('fs'),path=require('path');
const theme=require(process.argv[2]);
const dir=process.argv[3];
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&f!=='index.json');
const hex=h=>{const v=h.replace('#','');return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16)];};
const lin=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
const lum=h=>{const c=hex(h);return 0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);};
const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return Math.round(((hi+0.05)/(lo+0.05))*100)/100;};
for(const f of files){
  const t=theme.normalize(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
  const c=t.colors;
  const pairs=[['text','panel'],['text','background'],['muted','panel'],['muted','background'],['strong','panel'],['focus','panel'],['error','panel'],['success','panel'],['warning','panel']];
  const fails=[];
  for(const [fg,bg] of pairs){
    const r=ratio(c[fg].slice(0,7),c[bg].slice(0,7));
    const need=(fg==='muted'||fg==='text'||fg==='strong')?4.5:3.0;
    if(r<need) fails.push(`${fg}/${bg}=${r}<${need}`);
  }
  console.log(`${t.name.padEnd(18)} ${fails.length?('FAIL '+fails.join(' ')):'pass'}`);
}
