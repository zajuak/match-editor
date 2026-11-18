import path from 'node:path';
import {build,projectRoot} from './build.mjs';
const result=await build(path.join(projectRoot,'campus-dist'),{environment:{MATCH_EDITOR_SAME_ORIGIN:'true'},requireConfig:true});
console.log(`Built independent campus frontend ${result.destination} (assets ${result.version})`);
