// Minimal handle icon — small rounded rectangle
const handleIcon =
  'path://M18.1 10.7V9.3c-.3-4.9-4.4-8.8-9.4-8.8-5 0-9.1 3.9-9.4 8.8v1.3c.3 4.9 4.4 8.8 9.4 8.8C13.7 19.5 17.8 15.6 18.1 10.7zM5.6 13.3V6.7H7v6.6H5.6zM10.4 13.3V6.7h1.4v6.6H10.4z';

export const dataZoomPartial = {
  show: true,
  type: 'slider',
  handleIcon,
  handleSize: '80%',
  height: 20,
  borderColor: 'transparent',
  backgroundColor: 'rgba(120, 120, 140, 0.06)',
  fillerColor: 'rgba(99, 102, 241, 0.08)',
  handleStyle: {
    color: 'rgba(99, 102, 241, 0.4)',
    borderColor: 'rgba(99, 102, 241, 0.6)',
    borderWidth: 1,
  },
  moveHandleSize: 4,
  emphasis: {
    handleStyle: {
      color: 'rgba(99, 102, 241, 0.6)',
      borderColor: 'rgba(99, 102, 241, 0.8)',
    },
  },
  dataBackground: {
    lineStyle: {
      color: 'rgba(99, 102, 241, 0.15)',
      width: 1,
    },
    areaStyle: {
      color: 'rgba(99, 102, 241, 0.04)',
    },
  },
  selectedDataBackground: {
    lineStyle: {
      color: 'rgba(99, 102, 241, 0.3)',
      width: 1,
    },
    areaStyle: {
      color: 'rgba(99, 102, 241, 0.08)',
    },
  },
  textStyle: {
    color: 'rgba(160, 160, 180, 0.6)',
    fontSize: 10,
  },
};

export const echartsGridDefault = {
  left: '55',
  right: '30',
  bottom: 80,
};
