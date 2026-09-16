package com.datastorm.kicks.vpn
import java.nio.ByteBuffer
import java.nio.ByteOrder
data class DnsQuery(val source:ByteArray,val destination:ByteArray,val sourcePort:Int,val payload:ByteArray,val hostname:String)
object DnsPacketCodec {
 fun parse(packet:ByteArray,length:Int):DnsQuery? {
  if(length<28||(packet[0].toInt() ushr 4)!=4)return null
  val ihl=(packet[0].toInt()and 0x0f)*4
  if(ihl<20||length<ihl+8||packet[9].toInt()!=17||u16(packet,ihl+2)!=53)return null
  val udpLength=u16(packet,ihl+4)
  if(udpLength<20||ihl+udpLength>length)return null
  val payload=packet.copyOfRange(ihl+8,ihl+udpLength)
  val host=parseQuestion(payload)?:return null
  return DnsQuery(packet.copyOfRange(12,16),packet.copyOfRange(16,20),u16(packet,ihl),payload,host)
 }
 fun response(q:DnsQuery,dns:ByteArray):ByteArray {
  val total=28+dns.size;val out=ByteArray(total);out[0]=0x45;out[2]=(total ushr 8).toByte();out[3]=total.toByte();out[6]=0x40;out[8]=64;out[9]=17
  q.destination.copyInto(out,12);q.source.copyInto(out,16);out[20]=0;out[21]=53;out[22]=(q.sourcePort ushr 8).toByte();out[23]=q.sourcePort.toByte()
  val ul=8+dns.size;out[24]=(ul ushr 8).toByte();out[25]=ul.toByte();dns.copyInto(out,28);put16(out,10,checksum(out,0,20));put16(out,26,udpChecksum(out));return out
 }
 private fun parseQuestion(d:ByteArray):String? {
  if(d.size<17||u16(d,4)<1)return null
  var p=12;val labels=mutableListOf<String>()
  while(p<d.size){val n=d[p].toInt()and 0xff;p++;if(n==0)break;if(n>63||p+n>d.size)return null;val s=d.copyOfRange(p,p+n).toString(Charsets.US_ASCII).lowercase();if(!s.matches(Regex("[a-z0-9_-]+")))return null;labels.add(s);p+=n}
  return labels.joinToString(".").takeIf{it.isNotBlank()&&it.length<=253}
 }
 private fun udpChecksum(p:ByteArray):Int {val b=ByteBuffer.allocate(12+p.size-20).order(ByteOrder.BIG_ENDIAN);b.put(p,12,8);b.put(0);b.put(17);b.putShort((p.size-20).toShort());b.put(p,20,p.size-20);return checksum(b.array(),0,b.position())}
 private fun checksum(a:ByteArray,o:Int,l:Int):Int {var s=0L;var i=o;while(i<o+l){s+=((a[i].toInt()and 255)shl 8)+(if(i+1<o+l)a[i+1].toInt()and 255 else 0);s=(s and 0xffff)+(s ushr 16);i+=2};return(s.inv()and 0xffff).toInt()}
 private fun u16(a:ByteArray,i:Int)=((a[i].toInt()and 255)shl 8)+(a[i+1].toInt()and 255)
 private fun put16(a:ByteArray,i:Int,v:Int){a[i]=(v ushr 8).toByte();a[i+1]=v.toByte()}
}
