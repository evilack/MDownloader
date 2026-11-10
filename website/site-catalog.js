/** 정적 사이트의 동적 문구와 외부 연결 역할을 모읍니다. 스토어 주소는 발급 후
 * 각 역할의 url에 입력합니다. 언어별 화면 코드에 URL이나 문구 분기를 복제하지 않습니다. */
export const SiteCatalog = Object.freeze({
	stores: Object.freeze({
		chrome: Object.freeze({url: '', en: 'Chrome Web Store', ko: 'Chrome 웹 스토어'}),
		edge: Object.freeze({url: '', en: 'Microsoft Edge Add-ons', ko: 'Microsoft Edge 추가 기능'}),
	}),
	messages: Object.freeze({
		en: Object.freeze({
			storePending: 'We’re preparing the {store} listing. This button will open the installation page once the official store link is available.'}),
		ko: Object.freeze({
			storePending: '{store} 등록을 준비하고 있습니다. 정식 스토어 주소가 발급되면 이 버튼에서 설치 페이지로 연결됩니다.'}),
	}),
});
