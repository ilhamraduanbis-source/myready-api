const STATES={"johor":"01","kedah":"02","kelantan":"03","melaka":"04","malacca":"04","negeri sembilan":"05","pahang":"06","pulau pinang":"07","penang":"07","perak":"08","perlis":"09","selangor":"10","terengganu":"11","sabah":"12","sarawak":"13","kuala lumpur":"14","kl":"14","labuan":"15","putrajaya":"16"};
const PAYMENTS={"cash":"01","tunai":"01","cheque":"02","cek":"02","bank transfer":"03","online transfer":"03","transfer bank":"03","credit card":"04","kad kredit":"04","debit card":"05","kad debit":"05","e-wallet":"06","ewallet":"06","digital wallet":"06","digital bank":"07"};
const DOCUMENTS={"self-billed invoice":"11","self billed invoice":"11","credit note":"02","nota kredit":"02","debit note":"03","nota debit":"03","refund note":"04","nota bayaran balik":"04","invoice":"01","invois":"01"};

function resolveMalaysia(text){
 const low=text.toLowerCase(),resolved={},warnings=[];
 const moneyRe=/(?:rm|myr)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|ribu|juta|m)?/gi;
 const moneys=[];
 let mm;
 while((mm=moneyRe.exec(text))!==null){
  let amount=parseFloat(mm[1].replaceAll(",",""));
  const unit=(mm[2]||"").toLowerCase();
  if(["k","ribu"].includes(unit))amount*=1000;
  if(["juta","m"].includes(unit))amount*=1000000;
  moneys.push({amount,index:mm.index});
 }
 let ambiguous=false;
 if(moneys.length){
  let chosen=moneys[0];
  if(moneys.length>1){
   const hints=[...low.matchAll(/\b(?:grand\s+total|total|jumlah\s+keseluruhan|jumlah)\b/g)];
   const ranked=moneys.map(x=>({x,score:Math.max(-1,...hints.map(h=>{const d=x.index-h.index;return d>=0&&d<=35?100-d:-1;}))})).sort((a,b)=>b.score-a.score);
   if(ranked[0].score>=0)chosen=ranked[0].x;
   else {ambiguous=true;warnings.push("Multiple MYR amounts found; amount is ambiguous.");}
  }
  resolved.amount=chosen.amount;
  resolved.currency="MYR";
 }
 const phones=text.match(/(?<!\d)(?:\+?60[\s-]*1\d|01\d)(?:[\s-]*\d){7,8}(?!\d)/g)||[];
 for(const candidate of phones){let digits=candidate.replace(/\D/g,"");if(digits.startsWith("60"))digits="0"+digits.slice(2);if(/^01\d{8,9}$/.test(digits)&&!(digits.length===12&&/^20\d{10}$/.test(digits))){resolved.phone="+60"+digits.slice(1);break;}}
 let m=text.match(/(?<!\d)(\d{12})(?!\d)/);if(m){resolved.registration_no=m[1];warnings.push("SSM number parsed by format only; registration existence not verified.");}
 m=text.match(/(?<!\d)(\d{5})(?!\d)/);if(m){resolved.postcode=m[1];warnings.push("Postcode extracted; city/state relationship not yet verified against authoritative postcode data.");}
 for(const name of Object.keys(STATES).sort((a,b)=>b.length-a.length)){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");if(new RegExp(`(^|\\W)${escaped}(?=$|\\W)`,"i").test(low)){resolved.state_code=STATES[name];break;}}
 for(const name of Object.keys(PAYMENTS).sort((a,b)=>b.length-a.length)){if(low.includes(name)){resolved.payment_mode=PAYMENTS[name];break;}}
 for(const name of Object.keys(DOCUMENTS).sort((a,b)=>b.length-a.length)){if(low.includes(name)){resolved.document_type=DOCUMENTS[name];break;}}
 return {resolved,warnings,machine_ready:resolved.amount!==undefined&&resolved.currency==="MYR"&&!ambiguous};
}

export default{async fetch(request){const url=new URL(request.url);
 if(request.method==="GET"&&url.pathname==="/health")return Response.json({ok:true,service:"MYReady",version:"0.6"});
 if(request.method!=="POST"||url.pathname!=="/v1/malaysia/resolve")return Response.json({service:"MYReady",version:"0.6",status:"online",endpoints:{health:"GET /health",resolve:"POST /v1/malaysia/resolve"}},{status:404});
 let body;try{body=await request.json();}catch{return Response.json({error:"invalid_json"},{status:400});}
 if(typeof body.text!=="string"||!body.text.trim())return Response.json({error:"text_required"},{status:422});
 if(body.text.length>5000)return Response.json({error:"text_too_long"},{status:413});
 return Response.json(resolveMalaysia(body.text));}};