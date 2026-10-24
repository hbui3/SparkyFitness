package com.sparkyapps.sparkyfitness.workoutnotification

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/** Display-only notification; the workout store remains the source of truth. */
class WorkoutNotificationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WorkoutNotification"

    @ReactMethod
    fun show(payload: ReadableMap, promise: Promise) {
        try {
            val context = reactApplicationContext
            val manager = NotificationManagerCompat.from(context)
            if (!manager.areNotificationsEnabled()) {
                cancelRestDeadline(context)
                promise.resolve(null)
                return
            }
            ensureChannel(context, payload.getString("channelName") ?: "Ongoing workout")
            val openWorkout = Intent(Intent.ACTION_VIEW, Uri.parse("sparkyfitnessmobile://active-workout"))
                .setPackage(context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val pendingOpen = PendingIntent.getActivity(
                context, 0, openWorkout,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            manager.notify(NOTIFICATION_ID, buildNotification(context, payload, pendingOpen))
            scheduleRestDeadline(context, payload)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_WORKOUT_NOTIFICATION_SHOW", error)
        }
    }

    private fun buildNotification(
        context: Context,
        payload: ReadableMap,
        pendingOpen: PendingIntent
    ): Notification {
        val name = payload.getString("name") ?: ""
        val exercise = payload.getString("exerciseLine") ?: ""
        val progressText = payload.getString("progressText") ?: ""
        val setPosition = payload.getString("setPosition") ?: ""
        val phase = payload.getString("phase") ?: "active"
        val completedSets = payload.getInt("completedSets")
        val setCounts = payload.getArray("setCounts")
        var totalSets = 0
        if (setCounts != null) {
            for (index in 0 until setCounts.size()) totalSets += setCounts.getInt(index)
        }

        val contentText = if (phase == "complete") {
            exercise + " · " + (payload.getString("elapsedText") ?: "")
        } else {
            "$exercise · $setPosition"
        }
        val builder = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle(name)
            .setContentText(contentText)
            .setSubText(if (phase == "paused") payload.getString("restText") else progressText)
            .setContentIntent(pendingOpen)
            .setCategory(Notification.CATEGORY_STATUS)
            .setOngoing(true)
            .setOnlyAlertOnce(true)

        if (Build.VERSION.SDK_INT >= 36 && phase != "complete") {
            val style = Notification.ProgressStyle()
            if (setCounts != null) {
                for (index in 0 until setCounts.size()) {
                    val count = setCounts.getInt(index)
                    if (count > 0) style.addProgressSegment(Notification.ProgressStyle.Segment(count))
                }
            }
            style.setProgress(completedSets)
            builder.setStyle(style)
                .setShortCriticalText(setPosition)
                .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
        } else if (totalSets > 0) {
            builder.setProgress(totalSets, completedSets, false)
        }

        if (phase == "resting" && !payload.isNull("restEndsAt")) {
            builder.setWhen(payload.getDouble("restEndsAt").toLong())
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        } else if (phase != "complete") {
            builder.setWhen(payload.getDouble("startedAt").toLong())
                .setUsesChronometer(true)
        }
        return builder.build()
    }

    @ReactMethod
    fun clear(promise: Promise) {
        try {
            NotificationManagerCompat.from(reactApplicationContext).cancel(NOTIFICATION_ID)
            cancelRestDeadline(reactApplicationContext)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_WORKOUT_NOTIFICATION_CLEAR", error)
        }
    }

    private fun ensureChannel(context: Context, name: String) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
            description = name
            setSound(null, null)
            enableVibration(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun restDeadlineIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        1,
        Intent(context, RestDeadlineReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun cancelRestDeadline(context: Context) {
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarm.cancel(restDeadlineIntent(context))
        context.getSharedPreferences("workout-notification", Context.MODE_PRIVATE)
            .edit().remove("restEndsAt").remove("startedAt").apply()
    }

    private fun scheduleRestDeadline(context: Context, payload: ReadableMap) {
        cancelRestDeadline(context)
        if (payload.getString("phase") != "resting" || payload.isNull("restEndsAt")) return
        val endsAt = payload.getDouble("restEndsAt").toLong()
        context.getSharedPreferences("workout-notification", Context.MODE_PRIVATE)
            .edit()
            .putLong("restEndsAt", endsAt)
            .putLong("startedAt", payload.getDouble("startedAt").toLong())
            .apply()
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = PendingIntent.getBroadcast(
            context, 1,
            Intent(context, RestDeadlineReceiver::class.java).putExtra("restEndsAt", endsAt),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarm.canScheduleExactAlarms()) {
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, pending)
            } else {
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, pending)
            }
        } catch (_: SecurityException) {
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, pending)
        }
    }

    companion object {
        private const val CHANNEL_ID = "ongoing-workout"
        internal const val NOTIFICATION_ID = 3031
    }
}
