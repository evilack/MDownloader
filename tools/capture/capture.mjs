/** 공통 엔진의 대상/언어를 CLI 데이터로 선택합니다. 일반 웹 모션 촬영과 확장
 * 내부 페이지 촬영을 구분하며, 현재 세션의 브라우저 접근 제한을 우회하지 않습니다. */
import {parseArgs as ParseArgs} from 'node:util';
import {CaptureExtension} from '../lib/capture-extension.mjs';
import {CaptureSampleMotion} from '../lib/capture-sample-motion.mjs';
const {values: Values} = ParseArgs({options: {
		preset: {type: 'string', default: 'aligned'},
		motion: {type: 'boolean', default: false},
		locale: {type: 'string', default: 'ko'},
	}});
const Result = Values.motion ? await CaptureSampleMotion({locale: Values.locale}) : await CaptureExtension(Values.preset);
console.log(JSON.stringify(Result));
