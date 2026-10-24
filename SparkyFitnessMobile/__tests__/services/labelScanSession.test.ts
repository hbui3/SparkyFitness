import {
  clearLabelScanSession,
  getLabelScanGeneration,
  getLabelScanPhoto,
  rememberLabelScan,
} from '../../src/services/labelScanSession';

describe('labelScanSession', () => {
  afterEach(() => clearLabelScanSession());

  it('frees the photo when cleared', () => {
    rememberLabelScan('abc', 'device');
    expect(getLabelScanPhoto()).toBe('abc');
    clearLabelScanSession();
    expect(getLabelScanPhoto()).toBeNull();
  });

  it('keeps a newer scan when an older form closes', () => {
    rememberLabelScan('first', 'device');
    const oldForm = getLabelScanGeneration();
    rememberLabelScan('second', 'server');
    clearLabelScanSession(oldForm);
    expect(getLabelScanPhoto()).toBe('second');
    clearLabelScanSession(getLabelScanGeneration());
    expect(getLabelScanPhoto()).toBeNull();
  });
});
