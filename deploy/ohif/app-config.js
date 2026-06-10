/** OHIF 설정 — Orthanc DICOMweb (같은 오리진 /dicom-web 프록시 경유, CORS 불필요) */
window.config = {
  routerBasename: '/',
  showStudyList: true,
  defaultDataSourceName: 'saintview',
  investigationalUseDialog: { option: 'never' },
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'saintview',
      configuration: {
        friendlyName: 'Saintview Orthanc',
        name: 'saintview',
        wadoUriRoot: '/dicom-web',
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
      },
    },
  ],
};
