import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useCSSVariable } from 'uniwind';
import {
  buildLoopRequest,
  countRouteTurns,
  generateDistanceRange,
  nextBearingDeg,
  type GeneratedRoutePreview,
  type GenerateRouteBody,
  type RoutePoint,
} from '@workspace/shared';
import Button from '../components/ui/Button';
import { usePreferences } from '../hooks/usePreferences';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { addLog } from '../services/LogService';
import {
  generateRoutePreview,
  saveGeneratedRoute,
  useRouteGenerationAvailable,
} from '../services/routeService';
import { routeGenerateErrorMessage } from '../utils/routeGenerateError';
import { formatRouteClimb, formatRouteDistance } from '../utils/routeDisplay';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'RouteGenerate'>;
type Activity = GenerateRouteBody['activity'];
type Shape = Extract<GenerateRouteBody, { mode: 'loop' }>['shape'];
type Start = Pick<RoutePoint, 'lat' | 'lon'>;

const FALLBACK_REGION = {
  latitude: 39.8,
  longitude: -98.6,
  latitudeDelta: 40,
  longitudeDelta: 40,
};
const ACTIVITIES: Activity[] = ['run', 'walk', 'ride', 'hike'];
const DEFAULT_DISTANCE: Record<'km' | 'miles', string> = {
  km: '5',
  miles: '3',
};

const Chip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
}> = ({ label, selected, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    className={`px-3 py-2 rounded-full border ${
      selected
        ? 'bg-accent-primary border-accent-primary'
        : 'border-border-subtle'
    }`}
  >
    <Text
      className={`text-sm font-semibold ${
        selected ? 'text-white' : 'text-text-primary'
      }`}
    >
      {label}
    </Text>
  </Pressable>
);

/**
 * Generate a loop or out-and-back of a chosen distance from the person's
 * position (or a point they tap on the map) with the server's routing engine.
 * Shows a preview to regenerate (another heading) or save; needs the engine,
 * so without one it only explains that.
 */
const RouteGenerateScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { preferences } = usePreferences();
  const unit = preferences?.default_distance_unit ?? 'km';
  const lineColor = useCSSVariable('--color-accent-primary') as string;
  const { available, isLoading: checking } = useRouteGenerationAvailable();
  const mapRef = useRef<MapView>(null);
  const sequence = useRef(0);
  const pickedStart = useRef(false);

  const [activity, setActivity] = useState<Activity>('run');
  const [shape, setShape] = useState<Shape>('loop');
  const [distanceText, setDistanceText] = useState(DEFAULT_DISTANCE[unit]);
  const [start, setStart] = useState<Start | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);
  const [preview, setPreview] = useState<GeneratedRoutePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unitLabel =
    unit === 'miles'
      ? t('workout.mi', { defaultValue: 'mi' })
      : t('workout.km', { defaultValue: 'km' });
  const range = generateDistanceRange(unit);
  const distance = Number.parseFloat(distanceText.replace(',', '.'));
  const distanceValid =
    Number.isFinite(distance) && distance >= range.min && distance <= range.max;

  // Only refs and state setters inside, so it never changes and can sit in an
  // effect's dependencies.
  const locateMe = useCallback(() => {
    pickedStart.current = false;
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return;
      const position = await Location.getCurrentPositionAsync({});
      if (pickedStart.current) return;
      const here = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      setStart(here);
      mapRef.current?.animateToRegion?.(
        {
          latitude: here.lat,
          longitude: here.lon,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        },
        0
      );
    })().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (available) locateMe();
  }, [available, locateMe]);

  useEffect(() => {
    if (!preview || preview.points.length < 2) return;
    mapRef.current?.fitToCoordinates?.(
      preview.points.map((p) => ({ latitude: p.lat, longitude: p.lon })),
      {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: true,
      }
    );
  }, [preview]);

  const generate = (heading: number) => {
    if (!start) return;
    const request = buildLoopRequest({
      start,
      activity,
      shape,
      distance,
      unit,
      bearingDeg: heading,
    });
    if (!request) return;
    const mine = ++sequence.current;
    setBearing(heading);
    setLoading(true);
    setError(null);
    generateRoutePreview(request)
      .then((route) => {
        if (mine !== sequence.current) return;
        setPreview(route);
        setName(null);
      })
      .catch((failure: unknown) => {
        if (mine !== sequence.current) return;
        addLog(`[Routes] Could not generate a route: ${failure}`, 'WARNING');
        // The last good preview stays on screen.
        setError(failure);
      })
      .finally(() => {
        if (mine === sequence.current) setLoading(false);
      });
  };

  const routeName = (name ?? preview?.name ?? '').trim();
  const canSave = preview !== null && routeName !== '' && !loading;

  const save = () => {
    if (!preview) return;
    setSaving(true);
    void saveGeneratedRoute(preview, routeName)
      .then((route) => navigation.replace('RouteDetail', { id: route.id }))
      .catch((failure: unknown) => {
        addLog(
          `[Routes] Could not save a generated route: ${failure}`,
          'WARNING'
        );
        Toast.show({
          type: 'error',
          text1: t('routes.saveFailed', {
            defaultValue: 'Could not save the route',
          }),
        });
      })
      .finally(() => setSaving(false));
  };

  const header = useScreenHeader({
    title: t('screens.routeGenerate', { defaultValue: 'Generate a route' }),
    left: { kind: 'back' },
    right: available
      ? {
          kind: 'primary',
          onPress: save,
          disabled: !canSave || saving,
          busy: saving,
        }
      : undefined,
  });

  if (checking || !available) {
    return (
      <>
        {header}
        <View className="flex-1 bg-background items-center justify-center px-6">
          {checking ? (
            <ActivityIndicator />
          ) : (
            <>
              <Text className="text-text-secondary text-base text-center mb-4">
                {t('routes.generateUnavailable', {
                  defaultValue:
                    'Route generation needs a routing provider. Add one in Settings > External Providers on the web app. You can still draw a route on a map.',
                })}
              </Text>
              <Button variant="secondary" onPress={() => navigation.goBack()}>
                {t('routes.goBack', { defaultValue: 'Go back' })}
              </Button>
            </>
          )}
        </View>
      </>
    );
  }

  const coordinates = (preview?.points ?? []).map((p) => ({
    latitude: p.lat,
    longitude: p.lon,
  }));
  const activityLabel: Record<Activity, string> = {
    run: t('routes.activity.run', { defaultValue: 'Run' }),
    walk: t('routes.activity.walk', { defaultValue: 'Walk' }),
    ride: t('routes.activity.ride', { defaultValue: 'Ride' }),
    hike: t('routes.activity.hike', { defaultValue: 'Hike' }),
  };

  return (
    <>
      {header}
      <View className="flex-1 bg-background">
        <View className="flex-1">
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={FALLBACK_REGION}
            onPress={(event) => {
              const { latitude, longitude } = event.nativeEvent.coordinate;
              pickedStart.current = true;
              setStart({ lat: latitude, lon: longitude });
            }}
            showsUserLocation
            toolbarEnabled={false}
          >
            {coordinates.length > 1 ? (
              <Polyline
                coordinates={coordinates}
                strokeColor={lineColor}
                strokeWidth={4}
                lineCap="round"
                lineJoin="round"
              />
            ) : null}
            {start ? (
              <Marker
                coordinate={{ latitude: start.lat, longitude: start.lon }}
                pinColor="green"
              />
            ) : null}
          </MapView>
        </View>
        {/* The distance field sits low on the screen; keep it above the keyboard. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            className="bg-surface"
            style={{ maxHeight: 340, flexGrow: 0 }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom + 12,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-row flex-wrap gap-2">
              {ACTIVITIES.map((value) => (
                <Chip
                  key={value}
                  label={activityLabel[value]}
                  selected={activity === value}
                  onPress={() => setActivity(value)}
                />
              ))}
            </View>
            <View className="flex-row gap-2 mt-3">
              <Chip
                label={t('routes.shape.loop', { defaultValue: 'Loop' })}
                selected={shape === 'loop'}
                onPress={() => setShape('loop')}
              />
              <Chip
                label={t('routes.shape.outAndBack', {
                  defaultValue: 'Out and back',
                })}
                selected={shape === 'out_and_back'}
                onPress={() => setShape('out_and_back')}
              />
            </View>
            <View className="flex-row items-center mt-3">
              <Text className="text-text-primary text-base mr-3">
                {t('routes.distanceLabel', { defaultValue: 'Distance' })}
              </Text>
              <TextInput
                className="border-b border-border-subtle text-text-primary py-1 min-w-16"
                style={{ fontSize: 16 }}
                value={distanceText}
                onChangeText={setDistanceText}
                keyboardType="decimal-pad"
                maxLength={6}
                accessibilityLabel={t('routes.distanceLabel', {
                  defaultValue: 'Distance',
                })}
              />
              <Text className="text-text-secondary text-base ml-2">
                {unitLabel}
              </Text>
            </View>
            {!distanceValid ? (
              <Text className="text-text-secondary text-sm mt-1">
                {t('routes.distanceRange', {
                  min: range.min,
                  max: range.max,
                  unit: unitLabel,
                  defaultValue: 'Choose between {{min}} and {{max}} {{unit}}.',
                })}
              </Text>
            ) : null}
            <View className="flex-row items-center justify-between mt-3">
              <Text className="text-text-secondary text-sm flex-1 mr-3">
                {start
                  ? t('routes.startFrom', {
                      defaultValue:
                        'Starting at the green pin. Tap the map to move it.',
                    })
                  : t('routes.startUnknown', {
                      defaultValue:
                        'Waiting for your location. Or tap the map to choose a start.',
                    })}
              </Text>
              <Button variant="secondary" onPress={locateMe}>
                {t('routes.useMyLocation', { defaultValue: 'My location' })}
              </Button>
            </View>
            {error ? (
              <Text className="text-text-secondary text-sm mt-3">
                {routeGenerateErrorMessage(error, t)}
              </Text>
            ) : null}
            {preview ? (
              <View className="mt-3">
                <TextInput
                  className="border-b border-border-subtle text-text-primary py-1"
                  style={{ fontSize: 16 }}
                  value={name ?? preview.name}
                  onChangeText={setName}
                  maxLength={100}
                  accessibilityLabel={t('routes.nameLabel', {
                    defaultValue: 'Route name',
                  })}
                />
                <Text className="text-text-primary text-base font-semibold mt-2">
                  {formatRouteDistance(preview.distanceM, unit)}
                  {preview.elevationGainM !== null
                    ? ` · ${t('routes.climb', {
                        climb: formatRouteClimb(preview.elevationGainM, unit),
                        defaultValue: '{{climb}} climb',
                      })}`
                    : ''}
                  {` · ${t('routes.turnCount', {
                    count: countRouteTurns(preview.cues),
                    defaultValue: '{{count}} turns',
                    defaultValue_one: '{{count}} turn',
                    defaultValue_other: '{{count}} turns',
                  })}`}
                </Text>
              </View>
            ) : null}
            <View className="flex-row gap-2 mt-3">
              {preview ? (
                <View className="flex-1">
                  <Button
                    variant="secondary"
                    disabled={loading || !start || !distanceValid}
                    onPress={() => generate(nextBearingDeg(bearing))}
                  >
                    {t('routes.regenerate', {
                      defaultValue: 'Try another direction',
                    })}
                  </Button>
                </View>
              ) : (
                <View className="flex-1">
                  <Button
                    loading={loading}
                    disabled={!start || !distanceValid}
                    onPress={() => generate(nextBearingDeg(bearing))}
                  >
                    {t('routes.generate', { defaultValue: 'Generate' })}
                  </Button>
                </View>
              )}
              {loading && preview ? <ActivityIndicator /> : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </>
  );
};

export default RouteGenerateScreen;
