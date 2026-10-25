package com.datastorm.kicks.vpn

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets

data class QueuedUpload(val id:String,val path:String,val body:String,val kind:String,val hostname:String?,val packageName:String?,val enqueuedAt:String){
  fun toJsonLine():String=JSONObject().put("id",id).put("path",path).put("body",body).put("kind",kind).put("hostname",hostname?:JSONObject.NULL).put("packageName",packageName?:JSONObject.NULL).put("enqueuedAt",enqueuedAt).toString()
  companion object { fun fromJsonLine(line:String):QueuedUpload{val v=JSONObject(line);return QueuedUpload(v.getString("id"),v.getString("path"),v.getString("body"),v.getString("kind"),v.optString("hostname").takeIf{it.isNotBlank()&&it!="null"},v.optString("packageName").takeIf{it.isNotBlank()&&it!="null"},v.getString("enqueuedAt"))} }
}
class QueueCapacityException(message:String):IllegalStateException(message)
class DurableUploadQueue(context:Context){
 companion object{private const val MAX_PENDING_BYTES=64L*1024L*1024L}
 private val queueFile=File(context.noBackupFilesDir,"kicks-upload-queue-v1.jsonl")
 private val cursorFile=File(context.noBackupFilesDir,"kicks-upload-queue-v1.cursor")
 @Synchronized fun append(upload:QueuedUpload){val encoded=(upload.toJsonLine()+"\n").toByteArray(StandardCharsets.UTF_8);val cursor=readCursor();val pending=(queueFile.length()-cursor).coerceAtLeast(0);if(pending+encoded.size>MAX_PENDING_BYTES)throw QueueCapacityException("durable upload queue reached its 64 MB safety limit");queueFile.parentFile?.mkdirs();FileOutputStream(queueFile,true).use{it.write(encoded);it.flush();it.fd.sync()}}
 @Synchronized fun peek():QueuedUpload?{if(!queueFile.exists())return null;val cursor=readCursor();if(cursor>=queueFile.length())return null;FileInputStream(queueFile).use{stream->stream.channel.position(cursor);val line=stream.bufferedReader(StandardCharsets.UTF_8).readLine()?:return null;return QueuedUpload.fromJsonLine(line)}}
 @Synchronized fun acknowledge(expectedId:String){val current=peek()?:return;check(current.id==expectedId){"durable queue acknowledgement order changed"};val consumed=(current.toJsonLine()+"\n").toByteArray(StandardCharsets.UTF_8).size.toLong();val next=readCursor()+consumed;if(next>=queueFile.length()){FileOutputStream(queueFile,false).use{it.flush();it.fd.sync()};writeCursor(0)}else writeCursor(next)}
 @Synchronized fun hasPending():Boolean=queueFile.exists()&&readCursor()<queueFile.length()
 @Synchronized fun pendingBytes():Long=if(!queueFile.exists())0 else(queueFile.length()-readCursor()).coerceAtLeast(0)
 private fun readCursor():Long{if(!cursorFile.exists())return 0;return runCatching{cursorFile.readText(StandardCharsets.UTF_8).trim().toLong()}.getOrDefault(0).coerceIn(0,queueFile.length())}
 private fun writeCursor(value:Long){val temp=File(cursorFile.parentFile,"${cursorFile.name}.tmp");FileOutputStream(temp,false).use{it.write(value.toString().toByteArray(StandardCharsets.UTF_8));it.flush();it.fd.sync()};if(cursorFile.exists()&&!cursorFile.delete())throw IllegalStateException("unable to replace durable queue cursor");if(!temp.renameTo(cursorFile))throw IllegalStateException("unable to commit durable queue cursor")}
}
