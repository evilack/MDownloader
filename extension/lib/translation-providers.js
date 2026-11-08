const Urls = {
 google:'https://translation.googleapis.com/language/translate/v2',
 gemini:'https://generativelanguage.googleapis.com/v1beta',
 deepseek:'https://api.deepseek.com', openai:'https://api.openai.com/v1',
 kakao:'https://dapi.kakao.com/translation/v2/translate.json'
};

async function Json(Fetch, Url, Init)
{
 const Response = await Fetch(Url, Init);
 if (!Response.ok) throw new Error(`Translation service request failed (${Response.status})`);
 try { return await Response.json(); } catch { throw new Error('Translation service returned invalid JSON'); }
}
function AzureEndpoint(Value)
{
 const Url = new URL(Value || 'https://api.cognitive.microsofttranslator.com');
 if (Url.protocol !== 'https:' || Url.username || Url.password || Url.search || Url.hash || Url.pathname !== '/' || !(Url.hostname === 'api.cognitive.microsofttranslator.com' || Url.hostname.endsWith('.cognitiveservices.azure.com'))) throw new Error('Invalid Azure translation endpoint');
 return Url.origin;
}
function OutputArray(Text, Count)
{
 let Data;
 try { Data = JSON.parse(Text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new Error('Translation response was not valid JSON'); }
 const Items = Array.isArray(Data) ? Data : Data.cues;
 if (!Array.isArray(Items) || Items.length !== Count) throw new Error('Translation response has incorrect cue count');
 return Items.map((Item, Index) => {
  if (!Item || Item.id !== Index || typeof Item.text !== 'string' || !Item.text.trim()) throw new Error('Translation response has invalid cue IDs');
  return Item.text;
 });
}
function Prompt(Strings, Source, Target)
{
 return `Translate the following consecutive subtitle cues from ${Source} to ${Target}. Use the entire passage as context, keep each cue aligned with its original id, and preserve speaker intent. Return only JSON in the form {"cues":[{"id":0,"text":"..."}]}. Do not omit, add, or reorder cues.\n${JSON.stringify({cues:Strings.map((text,id)=>({id,text}))})}`;
}
function Lang(Code) { return String(Code || '').split('-')[0].toLowerCase(); }
export async function TranslateWithProvider(Provider, Config, Strings, Context, Fetch = fetch)
{
 if (!Config.key || !Array.isArray(Strings) || !Strings.length) throw new Error('Translation configuration is incomplete');
 const Source = Lang(Context.source), Target = Lang(Context.target), Signal = Context.signal;
 let Data, Result;
 const Headers = {'Content-Type':'application/json'};
 const Post = (Url, Body) => Json(Fetch, Url, {method:'POST',headers:Headers,body:JSON.stringify(Body),signal:Signal});
 if (Provider === 'google') {
  Headers['X-Goog-Api-Key'] = Config.key;
  Data = await Post(Urls.google, {q:Strings, source:Source || undefined, target:Target, format:'text', model:Config.model || 'nmt'});
  Result = Data.data?.translations?.map(X=>X.translatedText);
 } else if (Provider === 'deepl') {
  Headers.Authorization = `DeepL-Auth-Key ${Config.key}`;
  const Host = Config.key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  Data = await Post(`${Host}/v2/translate`, {text:Strings, source_lang:Source ? Source.toUpperCase() : undefined, target_lang:Target.toUpperCase(), ...(Config.model ? {model_type:Config.model}: {})});
  Result = Data.translations?.map(X=>X.text);
 } else if (Provider === 'azure') {
  const Endpoint = AzureEndpoint(Config.endpoint);
  Headers['Ocp-Apim-Subscription-Key'] = Config.key;
  if (Config.region) Headers['Ocp-Apim-Subscription-Region'] = Config.region;
  const Params = new URLSearchParams({'api-version':'3.0',to:Target}); if (Source) Params.set('from', Source);
  Data = await Post(`${Endpoint}/translate?${Params}`, Strings.map(Text=>({Text})));
  Result = Data.map(X=>X.translations?.[0]?.text);
 } else if (Provider === 'kakao') {
  Headers.Authorization = `KakaoAK ${Config.key}`; Result=[];
  for (const Text of Strings) {
   const Params = new URLSearchParams({source_lang:Source === 'ko' ? 'kr' : Source,target_lang:Target === 'ko' ? 'kr' : Target,q:Text});
   Data = await Json(Fetch, `${Urls.kakao}?${Params}`, {headers:Headers,signal:Signal});
   Result.push(Data.output?.map(X=>Array.isArray(X)?X.join(''):X).join('\n'));
  }
 } else if (Provider === 'gemini') {
  Headers['x-goog-api-key'] = Config.key;
  const Generation = {}; if (Config.effort) Generation.thinkingConfig = {thinkingLevel:Config.effort};
  Data = await Post(`${Urls.gemini}/models/${encodeURIComponent(Config.model)}:generateContent`, {contents:[{role:'user',parts:[{text:Prompt(Strings,Source,Target)}]}],generationConfig:Generation});
  if (Data.candidates?.[0]?.finishReason !== 'STOP') throw new Error('Translation response incomplete');
  Result = OutputArray(Data.candidates[0].content.parts.map(X=>X.text || '').join(''), Strings.length);
 } else if (Provider === 'deepseek') {
  Headers.Authorization = `Bearer ${Config.key}`;
  Data = await Post(`${Urls.deepseek}/chat/completions`, {model:Config.model, messages:[{role:'user',content:Prompt(Strings,Source,Target)}], response_format:{type:'json_object'}, ...(Config.effort ? {reasoning_effort:Config.effort}: {})});
  if (Data.choices?.[0]?.finish_reason !== 'stop') throw new Error('Translation response incomplete');
  Result = OutputArray(Data.choices[0].message.content, Strings.length);
 } else if (Provider === 'openai') {
  Headers.Authorization = `Bearer ${Config.key}`;
  Data = await Post(`${Urls.openai}/responses`, {model:Config.model,input:Prompt(Strings,Source,Target),store:false,text:{format:{type:'json_object'}}, ...(Config.effort ? {reasoning:{effort:Config.effort}}: {})});
  if (Data.status !== 'completed') throw new Error('Translation response incomplete');
  Result = OutputArray((Data.output || []).flatMap(X=>X.content || []).filter(X=>X.type === 'output_text').map(X=>X.text).join(''), Strings.length);
 } else throw new Error('Unsupported translation provider');
 if (!Array.isArray(Result) || Result.length !== Strings.length || Result.some(X=>typeof X !== 'string' || !X.trim())) throw new Error('Translation response has incorrect cue count');
 return Result;
}
export async function DiscoverModels(Provider, Config, Fetch = fetch)
{
 if (Provider === 'deepl') return ['latency_optimized','quality_optimized','prefer_quality_optimized'].map(id=>({id,efforts:[]}));
 if (Provider === 'google') return [{id:'nmt',efforts:[]}];
 if (Provider === 'azure' || Provider === 'kakao') return [];
 const Headers = {}, Url = Provider === 'gemini' ? `${Urls.gemini}/models?pageSize=1000` : Provider === 'deepseek' ? `${Urls.deepseek}/models` : Provider === 'openai' ? `${Urls.openai}/models` : null;
 if (!Url || !Config.key) throw new Error('Translation configuration is incomplete');
 if (Provider === 'gemini') Headers['x-goog-api-key']=Config.key; else Headers.Authorization=`Bearer ${Config.key}`;
 const Data = await Json(Fetch, Url, {headers:Headers});
 if (Provider === 'gemini') return (Data.models || []).filter(X=>X.supportedGenerationMethods?.includes('generateContent')).map(X=>{
  const id=X.name.replace(/^models\//,'');
  // The model list does not expose supported levels; only documented models are mapped.
  const efforts=/^gemini-3-flash(?:-|$)/.test(id) ? ['minimal','low','medium','high'] : [];
  return {id,label:X.displayName,efforts};
 });
 return (Data.data || []).map(X=>{
  let efforts=X.effort?.supported_levels ? ['none',...X.effort.supported_levels.filter(E=>E !== 'none')] : [];
  if (Provider === 'openai' && /^gpt-6(?:\.1)?-(?:sol|luna|astra)(?:-|$)/.test(X.id)) {
   efforts=['low','medium','high','xhigh','max'];
   if (/^gpt-6-(?:sol|luna)(?:-|$)/.test(X.id)) efforts.unshift('none');
  }
  return {id:X.id,label:X.name || X.id,efforts};
 });
}
