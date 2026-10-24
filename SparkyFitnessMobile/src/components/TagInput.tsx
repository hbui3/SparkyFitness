import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import Icon from './Icon';

export interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: readonly string[];
  resolveValue?: (input: string) => string;
  getLabel?: (value: string) => string;
  placeholder?: string;
  disabled?: boolean;
}

export const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  suggestions = [],
  resolveValue = (s) => s.trim(),
  getLabel = (s) => s,
  placeholder,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const [textMuted, raisedBg, borderSubtle, accentPrimary, colorSurface] =
    useCSSVariable([
      '--color-text-muted',
      '--color-raised',
      '--color-border-subtle',
      '--color-accent-primary',
      '--color-surface',
    ]) as [string, string, string, string, string];

  const selectedSet = useMemo(
    () => new Set(value.map((v) => v.toLowerCase())),
    [value]
  );

  const filteredSuggestions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    return suggestions.filter((item) => {
      const lower = item.toLowerCase();
      if (selectedSet.has(lower)) return false;
      if (!query) return true;
      const label = getLabel(item).toLowerCase();
      return lower.includes(query) || label.includes(query);
    });
  }, [suggestions, selectedSet, inputValue, getLabel]);

  const hasCustomAdd = useMemo(() => {
    const query = inputValue.trim();
    if (!query) return false;
    const resolved = resolveValue(query);
    if (selectedSet.has(resolved.toLowerCase())) return false;
    return !filteredSuggestions.some(
      (s) => s.toLowerCase() === resolved.toLowerCase()
    );
  }, [inputValue, resolveValue, selectedSet, filteredSuggestions]);

  const addTag = (tagToAdd: string) => {
    const resolvedTags = tagToAdd
      .split(',')
      .map((tag) => resolveValue(tag))
      .filter(Boolean);
    const tagsToAdd = resolvedTags.filter(
      (tag, index) =>
        !selectedSet.has(tag.toLowerCase()) &&
        resolvedTags.findIndex(
          (candidate) => candidate.toLowerCase() === tag.toLowerCase()
        ) === index
    );
    if (tagsToAdd.length === 0) {
      setInputValue('');
      return;
    }
    onChange([...value, ...tagsToAdd]);
    setInputValue('');
  };

  const removeTag = (indexToRemove: number) => {
    onChange(value.filter((_, i) => i !== indexToRemove));
  };

  return (
    <View className="gap-2 w-full">
      {/* Selected tags */}
      {value.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {value.map((tag, index) => (
            <View
              key={`${tag}-${index}`}
              className="flex-row items-center gap-1 bg-surface-raised px-2.5 py-1 rounded-full border border-border-subtle"
            >
              <Text className="text-xs text-text-primary font-medium">
                {getLabel(tag)}
              </Text>
              {!disabled && (
                <Pressable
                  hitSlop={8}
                  onPress={() => removeTag(index)}
                  accessibilityLabel={`${t('common.remove', {
                    defaultValue: 'Remove',
                  })} ${getLabel(tag)}`}
                >
                  <Icon name="close" size={12} color={textMuted} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Input */}
      {!disabled && (
        <View
          style={{
            backgroundColor: raisedBg,
            borderWidth: 1,
            borderColor: isFocused ? accentPrimary : borderSubtle,
            borderRadius: 8,
          }}
        >
          <TextInput
            className="text-base text-text-primary px-3 py-2.5"
            placeholderTextColor={textMuted}
            placeholder={
              placeholder ||
              t('workout.tagPlaceholder', {
                defaultValue: 'Type to add or search...',
              })
            }
            value={inputValue}
            onChangeText={setInputValue}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onSubmitEditing={() => {
              if (inputValue.trim()) {
                addTag(inputValue);
              }
            }}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}

      {/* Suggestions dropdown/tray when focused or typing */}
      {!disabled &&
        isFocused &&
        (filteredSuggestions.length > 0 || hasCustomAdd) && (
          <View
            className="rounded-lg border border-border-subtle overflow-hidden max-h-48"
            style={{ backgroundColor: colorSurface }}
          >
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {filteredSuggestions.map((item) => (
                <Pressable
                  key={item}
                  className="px-3 py-2.5 border-b border-border-subtle active:bg-surface-raised"
                  onPress={() => addTag(item)}
                >
                  <Text className="text-sm text-text-primary">
                    {getLabel(item)}
                  </Text>
                </Pressable>
              ))}

              {hasCustomAdd && (
                <Pressable
                  className="px-3 py-2.5 active:bg-surface-raised"
                  onPress={() => addTag(inputValue)}
                >
                  <Text className="text-sm text-accent-primary font-medium">
                    {t('workout.addCustomTag', {
                      tag: inputValue.trim(),
                      defaultValue: 'Add "{{tag}}"',
                    })}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        )}
    </View>
  );
};
