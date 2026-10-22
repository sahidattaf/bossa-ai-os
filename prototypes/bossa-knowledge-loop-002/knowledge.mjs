export const records = [
 {id:'menu-july',tenant:'bossa',topic:'chicken-salad-price',value:'XCG 12',date:'2026-07-02',status:'historical',source:'Notion July menu'},
 {id:'menu-legacy',tenant:'bossa',topic:'chicken-salad-price',value:'ANG 19.50',date:'2026-06-05',status:'historical',source:'Notion legacy menu'},
 {id:'box4',tenant:'bossa',topic:'box4',value:'Four chicken pieces, bread, baked potato, garlic sauce; XCG 19.50 historical listing',date:'2026-07-02',status:'historical',source:'Notion July menu'},
 {id:'papai',tenant:'papai',topic:'secret',value:'Papai private fixture',date:'2026-07-02',status:'approved',source:'Synthetic Papai fixture'}
];
export function answer({tenant='bossa',topic,language='en',sourceText=''}) {
 if(!['en','pap','nl','es'].includes(language)) return {status:'UNSUPPORTED_LANGUAGE'};
 const items=records.filter(r=>r.tenant===tenant && r.topic===topic);
 if(tenant!=='bossa') return {status:'ACCESS_DENIED',citations:[]};
 if(/ignore previous|publish|write to notion|system prompt/i.test(sourceText)) return {status:'UNTRUSTED_INSTRUCTION',citations:[]};
 if(!items.length) return {status:'INSUFFICIENT_EVIDENCE',citations:[]};
 if(new Set(items.map(x=>x.value)).size>1) return {status:'CONFLICT',citations:items.map(x=>x.id)};
 if(items[0].status!=='approved') return {status:'STALE',candidate:items[0].value,citations:[items[0].id]};
 return {status:'PASS',answer:items[0].value,citations:[items[0].id]};
}
export function report(topic){const a=answer({topic});return {role:'reporter',topic,proposedChange:null,reviewRequired:true,reason:a.status};}
export function verify(candidate){if(candidate.action && candidate.action!=='read')return {status:'BLOCKED_WRITE'};return answer({topic:candidate.topic});}
export function authorize(action){return action==='read';}
