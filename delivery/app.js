// Was the old Node proxy (server/). Now points at the NestJS backend
// directly; note the route also changed from POST /driver/location to
// PATCH /drivers/:id/location (see startGpsTracking below).
const API_URL = 'https://server-production-f5ce.up.railway.app/api';

// إرسال الموقع الجغرافي تلقائياً أثناء وردية التوصيل
function startGpsTracking(driverId) {
  if (!navigator.geolocation) {
    alert('خاصية الـ GPS غير مدعومة في متصفحك');
    return;
  }

  navigator.geolocation.watchPosition(
    async (pos) => {
      try {
        await fetch(`${API_URL}/drivers/${driverId}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // sends the driver's httpOnly access_token cookie
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          })
        });
        console.log('📍 تم تحديث موقع الطيار بنجاح:', pos.coords.latitude, pos.coords.longitude);
      } catch (e) {
        console.error('خطأ في إرسال الموقع');
      }
    },
    (err) => console.error(err),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

document.getElementById('gateSubmit')?.addEventListener('click', () => {
  const driverId = document.getElementById('driverIdInput').value.trim();
  if (driverId) {
    startGpsTracking(driverId);
  }
});