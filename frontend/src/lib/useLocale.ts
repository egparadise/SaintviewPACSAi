/** 언어 변경 시 화면을 다시 그리게 하는 훅.
 *  i18n.t() 는 모듈 전역 상태를 읽으므로, 언어가 바뀌어도 React 가 알아서 리렌더하지 않는다.
 *  화면 최상위(워크리스트·뷰어·설정)에서 한 번 부르면 그 트리 전체가 갱신된다. */
import { useEffect, useState } from "react";
import { getLocale, onLocaleChange } from "./i18n";

export function useLocale(): string {
  const [code, setCode] = useState(getLocale());
  useEffect(() => onLocaleChange(setCode), []);
  return code;
}
