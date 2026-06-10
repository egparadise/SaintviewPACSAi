# -*- coding: utf-8 -*-
"""Slicer — MPR 3면 + MIP 검증 레이아웃. Cornerstone3D 뷰어 결과와 교차 검증용.

실행: exec(open(r"...validate_mpr_mip.py", encoding="utf-8").read())
     setup_mpr_mip(slab_mm=30)   # Saintview 3D 뷰어의 MIP slab과 동일 값
"""


def setup_mpr_mip(slab_mm: float = 30.0, volume_node=None):
    import slicer

    if volume_node is None:
        volume_node = slicer.mrmlScene.GetFirstNodeByClass("vtkMRMLScalarVolumeNode")
    if volume_node is None:
        raise RuntimeError("로드된 볼륨이 없습니다 — fetch_study.load_study() 먼저 실행")

    # 4분할: Axial/Sagittal/Coronal + 3D
    slicer.app.layoutManager().setLayout(
        slicer.vtkMRMLLayoutNode.SlicerLayoutFourUpView
    )
    # 3면에 볼륨 배치
    for color in ("Red", "Yellow", "Green"):
        comp = slicer.app.layoutManager().sliceWidget(color).mrmlSliceCompositeNode()
        comp.SetBackgroundVolumeID(volume_node.GetID())

    # 각 슬라이스 뷰에 두께 슬랩 MIP 적용 (Cornerstone MIP과 비교 — 동일 slab)
    for color in ("Red", "Yellow", "Green"):
        slice_node = slicer.app.layoutManager().sliceWidget(color).mrmlSliceNode()
        slice_node.SetSlabReconstructionEnabled(True)
        slice_node.SetSlabReconstructionType(slicer.vtkMRMLSliceNode.Max)  # MIP
        slice_node.SetSlabReconstructionThickness(slab_mm)

    # 3D 뷰: 볼륨 렌더링(MIP 프리셋)
    vr_logic = slicer.modules.volumerendering.logic()
    display = vr_logic.CreateDefaultVolumeRenderingNodes(volume_node)
    display.SetVisibility(True)
    preset = vr_logic.GetPresetByName("CT-MIP")
    if preset:
        display.GetVolumePropertyNode().Copy(preset)
    slicer.util.resetThreeDViews()
    slicer.util.resetSliceViews()
    print(f"MPR(3면, MIP slab {slab_mm}mm) + 3D VR 구성 완료")
    print("검증: Saintview 3D 뷰어와 동일 W/L·slab으로 단면 위치를 맞춰 비교하세요")


print("사용법: setup_mpr_mip(slab_mm=30)")
