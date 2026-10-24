export interface FastingLog {
  id: string;
  user_id: string;
  start_time: string;
  end_time: string | null;
  target_end_time: string | null;
  duration_minutes: number | null;
  fasting_type: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  // mood and weight are stored in dedicated tables; fasting_logs no longer contains these fields
  mood_value?: number;
  mood_notes?: string;
  created_at?: string;
  updated_at?: string;
  is_auto_calculated?: boolean;
  start_meal_name?: string;
  end_meal_name?: string;
  is_eating_window?: boolean;
  eating_window_remaining_minutes?: number;
}

export interface UserFastingPreferences {
  id?: string;
  user_id: string;
  auto_calculate: boolean;
  default_protocol: string;
  target_fasting_hours: number;
  target_eating_hours: number;
  calorie_threshold: number;
  pre_end_alert_minutes: number;
  eating_window_alert: boolean;
}
