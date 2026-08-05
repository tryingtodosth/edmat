from django.contrib import admin

from .models import AvailabilityException, AvailabilityRule, Booking

admin.site.register(AvailabilityRule)
admin.site.register(AvailabilityException)
admin.site.register(Booking)
