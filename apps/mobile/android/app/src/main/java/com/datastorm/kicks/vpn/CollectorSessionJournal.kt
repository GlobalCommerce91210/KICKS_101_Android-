package com.datastorm.kicks.vpn

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID

data class CollectionLifecycleEvent(val eventId:String,val sessionId:String,val eventType:String,val occurredAt:String,val reason:String?,val lastHeartbeatAt:String?)
data class CollectorSessionStart(val sessionId:String,val crashEvent:CollectionLifecycleEvent?,val startedEvent:CollectionLifecycleEvent)

class CollectorSessionJournal(context:Context){
 private val stateFile=File(context.noBackupFilesDir,"kicks-collector-session-v1.json")
 @Synchronized fun begin(now:Instant=Instant.now()):CollectorSessionStart{val previous=readState();val nowText=now.toString();val crash=previous?.takeIf{it.active}?.let{CollectionLifecycleEvent(UUID.randomUUID().toString(),it.sessionId,"crash_detected",nowText,it.failureReason?:"collector_service_exited_without_a_clean_stop",it.lastHeartbeatAt)};val sessionId=UUID.randomUUID().toString();writeState(SessionState(sessionId,nowText,nowText,true,null));return CollectorSessionStart(sessionId,crash,CollectionLifecycleEvent(UUID.randomUUID().toString(),sessionId,"session_started",nowText,if(crash==null)"monitoring_started" else "learning_resumed_after_crash",nowText))}
 @Synchronized fun heartbeat(sessionId:String,now:Instant=Instant.now()):CollectionLifecycleEvent?{val current=readState()?:return null;if(!current.active||current.sessionId!=sessionId)return null;val nowText=now.toString();writeState(current.copy(lastHeartbeatAt=nowText));return CollectionLifecycleEvent(UUID.randomUUID().toString(),sessionId,"heartbeat",nowText,null,nowText)}
 @Synchronized fun end(sessionId:String,eventType:String,reason:String,now:Instant=Instant.now()):CollectionLifecycleEvent?{val current=readState()?:return null;if(!current.active||current.sessionId!=sessionId)return null;val nowText=now.toString();writeState(current.copy(lastHeartbeatAt=nowText,active=false,failureReason=null));return CollectionLifecycleEvent(UUID.randomUUID().toString(),sessionId,eventType,nowText,reason,nowText)}
 @Synchronized fun markFailure(sessionId:String,reason:String){val current=readState()?:return;if(current.active&&current.sessionId==sessionId)writeState(current.copy(failureReason=current.failureReason?:reason))}
 @Synchronized fun markUnclean(sessionId:String,reason:String){val current=readState()?:return;if(current.sessionId==sessionId)writeState(current.copy(active=true,failureReason=reason))}
 private data class SessionState(val sessionId:String,val startedAt:String,val lastHeartbeatAt:String,val active:Boolean,val failureReason:String?)
 private fun readState():SessionState?{if(!stateFile.exists())return null;return runCatching{val v=JSONObject(stateFile.readText(StandardCharsets.UTF_8));SessionState(v.getString("sessionId"),v.getString("startedAt"),v.getString("lastHeartbeatAt"),v.getBoolean("active"),v.optString("failureReason").takeIf{it.isNotBlank()&&it!="null"})}.getOrNull()}
 private fun writeState(state:SessionState){stateFile.parentFile?.mkdirs();val temp=File(stateFile.parentFile,"${stateFile.name}.tmp");val bytes=JSONObject().put("sessionId",state.sessionId).put("startedAt",state.startedAt).put("lastHeartbeatAt",state.lastHeartbeatAt).put("active",state.active).put("failureReason",state.failureReason?:JSONObject.NULL).toString().toByteArray(StandardCharsets.UTF_8);FileOutputStream(temp,false).use{it.write(bytes);it.flush();it.fd.sync()};if(stateFile.exists()&&!stateFile.delete())throw IllegalStateException("unable to replace collector session journal");if(!temp.renameTo(stateFile))throw IllegalStateException("unable to commit collector session journal")}
}
