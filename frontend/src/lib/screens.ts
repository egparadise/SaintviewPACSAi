// 모니터 배치 헬퍼 — Window Management API(Chrome)로 창 위치/크기 features 계산
// (뷰어/워크리스트/판독 창 공용 — Setting>모니터에서 선택한 인덱스 사용)

export async function screenFeatures(
  indices: number[] | null | undefined,
  fallback = "width=1500,height=920",
): Promise<string> {
  const sel = (indices ?? []).filter((i) => i >= 0);
  if (!sel.length || !("getScreenDetails" in window)) return fallback;
  try {
    const det = await (window as unknown as {
      getScreenDetails: () => Promise<{
        screens: { availLeft: number; availTop: number; availWidth: number; availHeight: number }[];
      }>;
    }).getScreenDetails();
    const scr = sel.map((i) => det.screens[i]).filter(Boolean);
    if (!scr.length) return fallback;
    const left = Math.min(...scr.map((s) => s.availLeft));
    const top = Math.min(...scr.map((s) => s.availTop));
    const right = Math.max(...scr.map((s) => s.availLeft + s.availWidth));
    const bottom = Math.max(...scr.map((s) => s.availTop + s.availHeight));
    return `left=${left},top=${top},width=${right - left},height=${bottom - top}`;
  } catch { return fallback; }
}
