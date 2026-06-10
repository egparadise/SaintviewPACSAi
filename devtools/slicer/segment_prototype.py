# -*- coding: utf-8 -*-
"""Slicer — 병변 분할 프로토타입 골격.

threshold 기반 분할 + 정량 통계. AI 모델(TotalSegmentator/MONAILabel/자체 모델)로
threshold 부분만 교체하면 동일한 정량·시각 검증 루프를 재사용한다.

실행: exec(open(r"...segment_prototype.py", encoding="utf-8").read())
     segment_by_threshold(low_hu=-600, high_hu=-400, name="LesionProto")
"""


def segment_by_threshold(low_hu: float, high_hu: float, name: str = "LesionProto", volume_node=None):
    import slicer

    if volume_node is None:
        volume_node = slicer.mrmlScene.GetFirstNodeByClass("vtkMRMLScalarVolumeNode")
    if volume_node is None:
        raise RuntimeError("로드된 볼륨이 없습니다")

    seg_node = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLSegmentationNode", name)
    seg_node.CreateDefaultDisplayNodes()
    seg_node.SetReferenceImageGeometryParameterFromVolumeNode(volume_node)
    seg_id = seg_node.GetSegmentation().AddEmptySegment(name)

    # Segment Editor threshold 효과 (→ AI 모델 추론 결과 주입으로 교체 지점)
    editor = slicer.qMRMLSegmentEditorWidget()
    editor.setMRMLScene(slicer.mrmlScene)
    editor_node = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLSegmentEditorNode")
    editor.setMRMLSegmentEditorNode(editor_node)
    editor.setSegmentationNode(seg_node)
    editor.setSourceVolumeNode(volume_node)
    editor.setActiveEffectByName("Threshold")
    effect = editor.activeEffect()
    effect.setParameter("MinimumThreshold", str(low_hu))
    effect.setParameter("MaximumThreshold", str(high_hu))
    effect.self().onApply()

    # 정량 통계 (부피 등) — AI 분할 평가에도 동일 사용
    import SegmentStatistics

    calc = SegmentStatistics.SegmentStatisticsLogic()
    calc.getParameterNode().SetParameter("Segmentation", seg_node.GetID())
    calc.getParameterNode().SetParameter("ScalarVolume", volume_node.GetID())
    calc.computeStatistics()
    stats = calc.getStatistics()
    vol_cm3 = stats.get((seg_id, "LabelmapSegmentStatisticsPlugin.volume_cm3"), "N/A")
    print(f"[{name}] HU {low_hu}~{high_hu} 분할 부피: {vol_cm3} cm³")
    print("AI 모델 교체 가이드: README.md 'AI 분할 모델 연구 경로' 참조")
    print("DICOM SEG 내보내기: File > Export to DICOM (동일 StudyUID로 Orthanc 저장 시 OHIF 오버레이)")
    return seg_node


print("사용법: segment_by_threshold(low_hu=-600, high_hu=-400)")
