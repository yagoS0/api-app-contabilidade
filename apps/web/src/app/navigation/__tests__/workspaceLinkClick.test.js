import { oNavegadorAssumeCliqueNoWorkspace as native } from '../workspaceLinkClick';
import { oNavegadorAssumeOClique as shared } from '../../../components/ui/cliqueDeLink';
const left={button:0,defaultPrevented:false,ctrlKey:false,shiftKey:false,altKey:false,metaKey:false};
// These are explicit unit fixtures, not evidence of a native macOS browser.
test.each(['Windows','Linux','Unknown',''])('Meta alone remains protected on %s',platform=>{
 expect(native({...left,metaKey:true},{userAgentData:{platform},platform})).toBe(false);
});
test.each(['macOS','MacIntel','MacPPC','Macintosh','iPad','iPhone','iPod'])('known Apple platform %s retains Meta delegation',platform=>{
 expect(native({...left,metaKey:true},{platform})).toBe(true);
});
test('client hint takes precedence; empty hint falls back; SSR null is protected',()=>{
 expect(native({...left,metaKey:true},{userAgentData:{platform:'Windows'},platform:'MacIntel'})).toBe(false);
 expect(native({...left,metaKey:true},{userAgentData:{platform:'macOS'},platform:'Win32'})).toBe(true);
 expect(native({...left,metaKey:true},{userAgentData:{platform:''},platform:'MacIntel'})).toBe(true);
 expect(native({...left,metaKey:true},null)).toBe(false);
 expect(native({...left,metaKey:true},{})).toBe(false);
 expect(native({...left,metaKey:true},{platform:'MacUnknown'})).toBe(false);
});
test.each([{ctrlKey:true},{shiftKey:true},{altKey:true},{metaKey:true,ctrlKey:true},{metaKey:true,shiftKey:true},{metaKey:true,altKey:true},{button:1},{button:2},{defaultPrevented:true}])('shared policy is retained for %j',change=>{
 const event={...left,...change};
 expect(native(event,{platform:'Win32'})).toBe(shared({...event,metaKey:false}));
 expect(native(event,{platform:'MacIntel'})).toBe(shared(event));
});
test('plain left click is still the app gesture and event is not mutated',()=>{
 const event=Object.freeze({...left,metaKey:true});
 native(event,{platform:'Win32'});expect(event.metaKey).toBe(true);
 expect(native(left,{platform:'Win32'})).toBe(false);
 expect(native(left,{platform:'MacIntel'})).toBe(false);
});