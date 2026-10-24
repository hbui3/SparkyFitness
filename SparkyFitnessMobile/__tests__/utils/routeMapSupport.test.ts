import { canShowRouteMap } from '../../src/utils/routeMapSupport';

describe('canShowRouteMap', () => {
  it('always draws a map on iOS, where Apple Maps needs no key', () => {
    expect(canShowRouteMap('ios', undefined)).toBe(true);
  });

  it('draws a map on Android only when the build had a Maps key', () => {
    expect(canShowRouteMap('android', { androidGoogleMapsEnabled: true })).toBe(
      true
    );
    expect(
      canShowRouteMap('android', { androidGoogleMapsEnabled: false })
    ).toBe(false);
    expect(canShowRouteMap('android', undefined)).toBe(false);
  });

  it('draws no map elsewhere', () => {
    expect(canShowRouteMap('web', { androidGoogleMapsEnabled: true })).toBe(
      false
    );
  });
});
