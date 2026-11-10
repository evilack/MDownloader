/* macOS-supplied JXA/Foundation: no Python or third-party runtime needed for bootstrap. */
ObjC.import('Foundation');
ObjC.bindFunction('flock',['int',['int','int']]);
var FM=$.NSFileManager.defaultManager;
var HostName='com.mdownloader.explorer'; // Shared client name; Finder never depends on this helper.
function fail(Code){throw new Error(Code);}
function nil(Value){return Value===null||Value===undefined||Value.isNil();}
function path(Path){return $(String(Path)).stringByStandardizingPath.js;}
function exists(Path){return !!FM.fileExistsAtPath($(Path));}
function safe(Path,Root){
 Path=path(Path);Root=path(Root);
 if(Path!==Root&&Path.indexOf(Root+'/')!==0)fail('unsafe_setup_path');
 var Current=Path;
 while(Current&&Current!=='/'){
  if(exists(Current)){
   var Attributes=FM.attributesOfItemAtPathError($(Current),null);
   if(nil(Attributes)||ObjC.unwrap(Attributes.objectForKey($.NSFileType))==='NSFileTypeSymbolicLink')fail('unsafe_setup_path');
  }else if(!nil(FM.destinationOfSymbolicLinkAtPathError($(Current),null)))fail('unsafe_setup_path');
  Current=path(Current+'/..');
 }
 return Path;
}
function root(Path){
 var Expected=path($.NSHomeDirectory().js+'/Library/Application Support/MDownloader/CommonHelper');
 if(path(Path)!==Expected)fail('unsafe_setup_path');return safe(Path,Expected);
}
function data(Text){return $(String(Text)).dataUsingEncoding($.NSUTF8StringEncoding);}
function text(Data){if(nil(Data))fail('invalid_setup_payload');var Value=$.NSString.alloc.initWithDataEncoding(Data,$.NSUTF8StringEncoding);if(nil(Value))fail('invalid_setup_payload');return Value.js;}
function read(Path,Limit){
 var Bytes=FM.contentsAtPath($(Path));if(nil(Bytes)||Number(Bytes.length)>Limit)fail('invalid_setup_payload');return text(Bytes);
}
function json(Path,Limit){return JSON.parse(read(Path,Limit||524288));}
function write(Path,Value,Root){
 safe(Path,Root);if(!data(JSON.stringify(Value)).writeToFileAtomically($(Path),true))fail('setup_write_failed');
}
function command(Executable,Args){
 var Task=$.NSTask.alloc.init,Pipe=$.NSPipe.pipe;
 Task.launchPath=$(Executable);Task.arguments=Args;Task.standardOutput=Pipe;Task.standardError=Pipe;
 var Environment=ObjC.deepUnwrap($.NSProcessInfo.processInfo.environment);Environment.LC_ALL='C';Task.environment=Environment;
 Task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
 Task.launch;var Output=Pipe.fileHandleForReading.readDataToEndOfFile;Task.waitUntilExit;
 return {status:Number(Task.terminationStatus),text:text(Output)};
}
function identity(Pid){
 if(!Number.isInteger(Number(Pid))||Number(Pid)<=0)return '';
 var Result=command('/bin/ps',['-p',String(Pid),'-o','lstart=']);return Result.status===0?Result.text.trim():'';
}
function filePath(Path,Root){
 Path=safe(Path,Root);
 if(exists(Path)&&ObjC.unwrap(FM.attributesOfItemAtPathError($(Path),null).objectForKey($.NSFileType))==='NSFileTypeDirectory')fail('unsafe_setup_path');return Path;
}
function removeFile(Path,Root){
 filePath(Path,Root);if(!exists(Path))return;
 if(!FM.removeItemAtPathError($(Path),null))fail('setup_cleanup_failed');
}
function removeEmptyDirectory(Path,Root){
 safe(Path,Root);if(!exists(Path))return;
 var Entries=FM.contentsOfDirectoryAtPathError($(Path),null);
 if(nil(Entries))fail('setup_cleanup_failed');if(Number(Entries.count)===0&&!FM.removeItemAtPathError($(Path),null))fail('setup_cleanup_failed');
}
function lock(Root,Action){
 // The installer creates this persistent file once and never replaces/unlinks it.
 // Kernel ownership is released on process death; there is no stale-lock deletion race.
 var File=safe(Root+'/.setup.lock',Root),Handle=$.NSFileHandle.fileHandleForUpdatingAtPath($(File)),Acquired=false;
 if(nil(Handle))fail('setup_write_failed');
 try{
  for(var Attempt=0;Attempt<200;Attempt++){
   if($.flock(Number(Handle.fileDescriptor),6)===0){Acquired=true;break;} // LOCK_EX | LOCK_NB
   $.NSThread.sleepForTimeInterval(0.05);
  }
  if(!Acquired)fail('common_setup_busy');return Action();
 }finally{if(Acquired)$.flock(Number(Handle.fileDescriptor),8);Handle.closeFile;}
}
function validOrigin(Origin){return /^chrome-extension:\/\/[a-p]{32}\/$/.test(Origin);}
function authorize(Root,Origin){if(!validOrigin(Origin)||json(safe(Root+'/host-manifest.json',Root)).allowed_origins.indexOf(Origin)===-1)fail('origin_denied');}
function statePath(Root){return safe(Root+'/caption-setup-state.json',Root);}
function readState(Root){
 var File=statePath(Root);if(!exists(File))return null;var State=json(File);
 if(!/^[a-f0-9]{32}$/.test(State.jobId)||!validOrigin(State.origin)||['queued','installing','complete','failed'].indexOf(State.status)===-1||!Number.isFinite(Date.parse(State.started)))fail('invalid_setup_state');return State;
}
function label(Job){return 'com.mdownloader.common.caption-setup.'+Job;}
function domain(){var User=command('/usr/bin/id',['-u']);if(User.status!==0||!/^\d+$/.test(User.text.trim()))fail('setup_launch_failed');return 'gui/'+User.text.trim();}
function jobRunning(State){
 var Result=command('/bin/launchctl',['print',domain()+'/'+label(State.jobId)]);
 if(Result.status!==0)return false;
 if(State.status==='queued')return /state = running/.test(Result.text);
 return identity(State.pid)===State.processStarted&&new RegExp('\\bpid = '+Number(State.pid)+'\\b').test(Result.text);
}
function packageNames(Bundle){
 if(!Bundle||typeof Bundle!=='object'||Array.isArray(Bundle)||Object.keys(Bundle).some(function(K){return K!=='version'&&K!=='packageVersion'&&K!=='files';})||Bundle.version!==1||!Bundle.files||typeof Bundle.files!=='object'||Array.isArray(Bundle.files))fail('invalid_setup_payload');
 if(Object.prototype.hasOwnProperty.call(Bundle,'packageVersion')&&(!Number.isInteger(Bundle.packageVersion)||Bundle.packageVersion<1||Bundle.packageVersion>1000000))fail('invalid_setup_payload');
 var Names=Object.keys(Bundle.files),Entries=Object.create(null),Files=Object.create(null);
 if(Names.length<1||Names.length>128||Names.indexOf('bootstrap.sh')===-1)fail('invalid_setup_payload');
 Names.forEach(function(Name){
  if(Name.length>240||!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(Name))fail('invalid_setup_payload');
  var Prefix='';Name.split('/').forEach(function(Part){
   if(Part==='.'||Part==='..'||/\.$/.test(Part)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(Part))fail('invalid_setup_payload');
   Prefix=Prefix?Prefix+'/'+Part:Part;var Key=Prefix.toLowerCase();
   if(Entries[Key]!==undefined&&Entries[Key]!==Prefix)fail('invalid_setup_payload');Entries[Key]=Prefix;
  });
  var Key=Name.toLowerCase();if(Files[Key])fail('invalid_setup_payload');Files[Key]=true;
 });
 Names.forEach(function(Name){var Parts=Name.split('/');Parts.pop();while(Parts.length){if(Files[Parts.join('/').toLowerCase()])fail('invalid_setup_payload');Parts.pop();}});
 return Names;
}
function cleanupPackage(Stage,Root,Names){
 Stage=safe(Stage,Root);if(!exists(Stage))return;var Parents=Object.create(null);
 Names.forEach(function(Name){
  removeFile(Stage+'/'+Name,Root);var Parts=Name.split('/');Parts.pop();
  while(Parts.length){Parents[Stage+'/'+Parts.join('/')]=true;Parts.pop();}
 });
 Object.keys(Parents).sort(function(A,B){return B.length-A.length;}).forEach(function(Parent){removeEmptyDirectory(Parent,Root);});
 removeEmptyDirectory(Stage,Root);
}
function cleanup(Root,Job){
 if(!/^[a-f0-9]{32}$/.test(Job))fail('invalid_setup_job');
 // A previous worker may exit after the next job replaced the package. Its
 // declared files were already cleaned under the install lock before that update.
 var State=readState(Root);if(!State||State.jobId!==Job)return;
 var Stage=safe(Root+'/caption-setup-'+Job,Root);
 if(exists(Stage))cleanupPackage(Stage,Root,packageNames(json(filePath(Root+'/caption-installer.json',Root),2097152)));
 removeFile(Root+'/caption-job-'+Job+'.plist',Root);
}
function currentState(Root){
 var State=readState(Root);if(!State)return null;
 if(State.status==='queued'||State.status==='installing'){
  // A live job is never expired solely by age. launchd owns the worker's process group.
  var Young=Date.now()-Date.parse(State.started)<30000;
  if(!(State.status==='queued'&&Young)&&!jobRunning(State)){
   command('/bin/launchctl',['bootout',domain()+'/'+label(State.jobId)]);
   State.status='failed';State.error='common_setup_interrupted';write(statePath(Root),State,Root);cleanup(Root,State.jobId);
  }
 }
 return State;
}
function response(State){return State?{ok:true,jobId:State.jobId,status:State.status,error:State.error||''}:{ok:true,status:'idle'};}
function xml(Value){return String(Value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function install(Root,Origin,Package){return lock(Root,function(){
 var Old=currentState(Root);
 if(Old&&(Old.status==='queued'||Old.status==='installing')){if(Package!==undefined||Old.origin!==Origin)fail('common_setup_busy');return response(Old);}
 if(Old){command('/bin/launchctl',['bootout',domain()+'/'+label(Old.jobId)]);cleanup(Root,Old.jobId);}
 if(Package!==undefined)updatePackage(Root,Package);
 var Job=$.NSUUID.UUID.UUIDString.js.replace(/-/g,'').toLowerCase();
 var State={jobId:Job,origin:Origin,status:'queued',error:'',started:new Date().toISOString(),pid:0,processStarted:''};
 var Plist=safe(Root+'/caption-job-'+Job+'.plist',Root);
 var Args=['/bin/bash',safe(Root+'/worker.sh',Root),Root,Origin,Job];
 var Body='<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>'+label(Job)+'</string><key>ProgramArguments</key><array>'+Args.map(function(A){return '<string>'+xml(A)+'</string>';}).join('')+'</array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>AbandonProcessGroup</key><false/><key>ExitTimeOut</key><integer>10</integer><key>StandardOutPath</key><string>'+xml(safe(Root+'/caption-setup.stdout.log',Root))+'</string><key>StandardErrorPath</key><string>'+xml(safe(Root+'/caption-setup.stderr.log',Root))+'</string></dict></plist>';
 Body=Body.replace('<key>RunAtLoad</key>','<key>EnvironmentVariables</key><dict><key>HOME</key><string>'+xml($.NSHomeDirectory().js)+'</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string><key>LC_ALL</key><string>C</string></dict><key>RunAtLoad</key>');
 if(!data(Body).writeToFileAtomically($(Plist),true))fail('setup_write_failed');
 write(statePath(Root),State,Root);
 var Started=command('/bin/launchctl',['bootstrap',domain(),Plist]);
 if(Started.status!==0){State.status='failed';State.error='setup_launch_failed';write(statePath(Root),State,Root);removeFile(Plist,Root);fail('setup_launch_failed');}
 return response(State);
});}
function setState(Root,Origin,Job,Status,Pid){lock(Root,function(){
 authorize(Root,Origin);var State=readState(Root);
 if(!State||State.jobId!==Job||State.origin!==Origin)fail('invalid_setup_job');
 if(Status==='installing'){
  if(State.status!=='queued'||!identity(Pid))fail('invalid_setup_job');State.pid=Number(Pid);State.processStarted=identity(Pid);
 }else if((Status!=='complete'&&Status!=='failed')||State.status!=='installing'||State.pid!==Number(Pid)||State.processStarted!==identity(Pid))fail('invalid_setup_job');
 State.status=Status;State.error=Status==='failed'?'caption_install_failed':'';write(statePath(Root),State,Root);
});}
function extractBundle(Bundle,Root,Stage){
 var Names=packageNames(Bundle);
 Stage=safe(Stage,Root);if(exists(Stage))fail('invalid_setup_payload');
 if(!FM.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(Stage),false,null,null))fail('setup_write_failed');
 var Total=0;
 Names.forEach(function(Name){
  var File=Bundle.files[Name];if(!File||typeof File!=='object'||Array.isArray(File)||Object.keys(File).length!==2||Object.keys(File).some(function(K){return K!=='base64'&&K!=='sha256';})||typeof File.base64!=='string'||File.base64.length>1398104||typeof File.sha256!=='string'||!/^[a-f0-9]{64}$/.test(File.sha256))fail('invalid_setup_payload');
  var Bytes=$.NSData.alloc.initWithBase64EncodedStringOptions($(File.base64),0);if(nil(Bytes))fail('invalid_setup_payload');
  Total+=Number(Bytes.length);if(Total>1048576||Bytes.base64EncodedStringWithOptions(0).js!==File.base64)fail('invalid_setup_payload');
  var FilePath=filePath(Stage+'/'+Name,Root),Parent=safe(FilePath.slice(0,FilePath.lastIndexOf('/')),Root);
  if(!FM.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(Parent),true,null,null))fail('setup_write_failed');
  filePath(FilePath,Root);if(!Bytes.writeToFileAtomically($(FilePath),true))fail('setup_write_failed');
  var Hash=command('/usr/bin/shasum',['-a','256',FilePath]);if(Hash.status!==0||Hash.text.split(/\s+/)[0]!==File.sha256)fail('invalid_setup_payload');
 });
}
function updatePackage(Root,Package){
 if(!Package||typeof Package!=='object'||Array.isArray(Package)||Object.keys(Package).some(function(K){return K!=='version'&&K!=='packageVersion'&&K!=='files';})||!Number.isInteger(Package.packageVersion)||Package.packageVersion<1||Package.packageVersion>1000000)fail('invalid_setup_payload');
 var Names=packageNames(Package),Target=filePath(Root+'/caption-installer.json',Root),Stage=safe(Root+'/caption-package-'+$.NSUUID.UUID.UUIDString.js.replace(/-/g,'').toLowerCase(),Root);
 try{
  extractBundle(Package,Root,Stage);
  // Validation and replacement share the setup lock, before any worker is queued.
  write(Target,Package,Root);
 }finally{
  cleanupPackage(Stage,Root,Names);
 }
}
function extract(Root,Origin,Job){
 authorize(Root,Origin);var State=readState(Root);if(!State||State.jobId!==Job||State.origin!==Origin||State.status!=='installing')fail('invalid_setup_job');
 extractBundle(json(filePath(Root+'/caption-installer.json',Root),2097152),Root,Root+'/caption-setup-'+Job);
}
function register(Root,Id){
 if(!/^[a-p]{32}$/.test(Id))fail('origin_denied');
 var File=safe(Root+'/host-manifest.json',Root),Origins=['chrome-extension://'+Id+'/'];
 if(exists(File)){var Previous=json(File);if(Previous.name===HostName&&Previous.path===Root+'/host.sh')Origins=Origins.concat((Previous.allowed_origins||[]).filter(validOrigin));else fail('foreign_registration');}
 Origins=Origins.filter(function(O,I,A){return A.indexOf(O)===I;});
 var Manifest={name:HostName,description:'MDownloader common helper',path:Root+'/host.sh',type:'stdio',allowed_origins:Origins};
 ['Google/Chrome','Microsoft Edge'].forEach(function(Browser){
  var Directory=$.NSHomeDirectory().js+'/Library/Application Support/'+Browser+'/NativeMessagingHosts',Target=Directory+'/'+HostName+'.json';
  safe(Target,$.NSHomeDirectory().js);
  if(exists(Target)){var Previous=json(Target);if(Previous.name!==HostName||Previous.path!==Manifest.path)fail('foreign_registration');}
 });
 write(File,Manifest,Root);
 ['Google/Chrome','Microsoft Edge'].forEach(function(Browser){
  var Directory=$.NSHomeDirectory().js+'/Library/Application Support/'+Browser+'/NativeMessagingHosts';
  if(!FM.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(Directory),true,null,null))fail('setup_write_failed');write(Directory+'/'+HostName+'.json',Manifest,$.NSHomeDirectory().js);
 });
}
function installHelper(Root,Source,Id){return lock(Root,function(){
 var State=currentState(Root);if(State&&(State.status==='queued'||State.status==='installing'))fail('common_setup_busy');
 Source=path(Source);
 ['host.sh','host.js','worker.sh'].forEach(function(Name){
  var From=safe(Source+'/'+Name,Source),To=safe(Root+'/'+Name,Root),Bytes=FM.contentsAtPath($(From));
  if(nil(Bytes)||Number(Bytes.length)>524288)fail('invalid_setup_payload');
  if(!Bytes.writeToFileAtomically($(To),true))fail('setup_write_failed');
  if(command('/bin/chmod',[Name==='host.sh'||Name==='worker.sh'?'700':'600',To]).status!==0)fail('setup_write_failed');
 });
 register(Root,Id);
});}
function uninstallHelper(Root){return lock(Root,function(){
 var State=currentState(Root);
 if(State&&(State.status==='queued'||State.status==='installing'))fail('common_setup_busy');
 var Home=$.NSHomeDirectory().js,Registrations=[];
 ['Google/Chrome','Microsoft Edge'].forEach(function(Browser){
  var File=safe(Home+'/Library/Application Support/'+Browser+'/NativeMessagingHosts/'+HostName+'.json',Home);
  if(exists(File)){var Manifest=json(File);if(Manifest.name!==HostName||Manifest.path!==Root+'/host.sh')fail('foreign_registration');Registrations.push(File);}
 });
 var Names=['host.sh','host.js','worker.sh','caption-installer.json','host-manifest.json','caption-setup-state.json','caption-setup.stdout.log','caption-setup.stderr.log'];
 // Preflight every named helper file before changing registrations. Captions is a separate root.
 Names.forEach(function(Name){var File=safe(Root+'/'+Name,Root);if(exists(File)&&ObjC.unwrap(FM.attributesOfItemAtPathError($(File),null).objectForKey($.NSFileType))==='NSFileTypeDirectory')fail('unsafe_setup_path');});
 if(State){command('/bin/launchctl',['bootout',domain()+'/'+label(State.jobId)]);cleanup(Root,State.jobId);}
 Registrations.forEach(function(File){removeFile(File,Home);});
 Names.forEach(function(Name){removeFile(Root+'/'+Name,Root);});
 // Keep the lock inode and its empty parent: deleting it would let a concurrent installer
 // acquire a new lock while this removal transaction still owns the old inode.
 return {ok:true,removed:true,retainedCaptionFiles:true};
});}
var Alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytes(Data){var Input=Data.base64EncodedStringWithOptions(0).js,Out=[],Bits=0,Count=0;
 for(var I=0;I<Input.length;I++){var Value=Alphabet.indexOf(Input.charAt(I));if(Value<0)break;Bits=(Bits<<6)|Value;Count+=6;if(Count>=8){Count-=8;Out.push((Bits>>Count)&255);}}return Out;}
function encoded(Bytes){var Out='';for(var I=0;I<Bytes.length;I+=3){var A=Bytes[I],B=Bytes[I+1],C=Bytes[I+2];Out+=Alphabet[A>>2]+Alphabet[((A&3)<<4)|((B||0)>>4)]+(B===undefined?'=':Alphabet[((B&15)<<2)|((C||0)>>6)])+(C===undefined?'=':Alphabet[C&63]);}return Out;}
function readExact(Handle,Size){var Result=$.NSMutableData.data;while(Number(Result.length)<Size){var Part=Handle.readDataOfLength(Size-Number(Result.length));if(nil(Part)||Number(Part.length)===0)fail('invalid_message');Result.appendData(Part);}return Result;}
function send(Value){var Body=data(JSON.stringify(Value)),Size=Number(Body.length),Header=$.NSData.alloc.initWithBase64EncodedStringOptions($(encoded([Size&255,(Size>>>8)&255,(Size>>>16)&255,(Size>>>24)&255])),0),Output=$.NSFileHandle.fileHandleWithStandardOutput;Output.writeData(Header);Output.writeData(Body);}
function run(Args){
 if(Args[0].indexOf('--')===0){
  var Mode=Args[0],Root=root(Args[1]);
  if(Mode==='--install')installHelper(Root,Args[2],Args[3]);
  else if(Mode==='--register')lock(Root,function(){register(Root,Args[2]);});
  else if(Mode==='--can-update')lock(Root,function(){var State=currentState(Root);if(State&&(State.status==='queued'||State.status==='installing'))fail('common_setup_busy');});
  else if(Mode==='--state')setState(Root,Args[2],Args[3],Args[4],Args[5]);
  else if(Mode==='--extract')extract(Root,Args[2],Args[3]);
  else if(Mode==='--cleanup')lock(Root,function(){cleanup(Root,Args[2]);});
  else fail('invalid_message');
  return;
 }
 var Reply;
 try{
  var Root=root(Args[0]),Origin=Args[1];authorize(Root,Origin);
  var Input=$.NSFileHandle.fileHandleWithStandardInput,Header=bytes(readExact(Input,4)),Size=Header[0]+Header[1]*256+Header[2]*65536+Header[3]*16777216;
  if(Size<1||Size>2097152)fail('invalid_message');var Message=JSON.parse(text(readExact(Input,Size)));
  if(!Message||typeof Message!=='object'||Array.isArray(Message))fail('invalid_message');var Keys=Object.keys(Message);
  if(Keys.some(function(K){return K!=='action'&&K!=='jobId'&&K!=='package';})||(Message.action!=='installCaptions'&&(Size>16384||Object.prototype.hasOwnProperty.call(Message,'package'))))fail('invalid_message');
  if(Message.action==='ping')Reply={ok:true,protocol:1,helperVersion:9,platform:'mac',capabilities:['captionSetup','captionPackageUpdate','genericPackageManifest'],canUninstall:true};
  else if(Message.action==='uninstall'){if(Message.jobId!==undefined)fail('invalid_message');Reply=uninstallHelper(Root);}
  else if(Message.action==='installCaptions'){if(Message.jobId!==undefined)fail('invalid_message');Reply=install(Root,Origin,Message.package);}
  else if(Message.action==='captionSetupStatus'){
   if(!/^[a-f0-9]{32}$/.test(Message.jobId))fail('invalid_setup_job');
   Reply=lock(Root,function(){var State=currentState(Root);if(State&&State.origin!==Origin)fail('common_setup_busy');if(!State||State.jobId!==Message.jobId)fail('invalid_setup_job');return response(State);});
  }else fail('invalid_message');
 }catch(ErrorValue){var Code=String(ErrorValue.message||ErrorValue);Reply={ok:false,code:/^(origin_denied|invalid_message|invalid_setup_job|invalid_setup_state|unsafe_setup_path|common_setup_busy|invalid_setup_payload|setup_launch_failed|foreign_registration)$/.test(Code)?Code:'common_setup_failed'};}
 send(Reply);
}
