# EdMat prototype: one process, zero dependencies. Data lives in /data (mount a volume).
FROM node:18-alpine
# Strefa czasowa szkoły (REL-09). Logika dziennika liczy czas przez Intl z jawną strefą (obraz
# node:18 ma pełne ICU, więc Europe/Warsaw działa nawet bez bazy stref systemu), ale TZ musi być
# prawdziwe także dla libc — logi, `date`, zadania cron. Obraz alpine nie ma bazy stref, stąd tzdata.
RUN apk add --no-cache tzdata
WORKDIR /app
COPY . .
ENV PORT=3000 EDMAT_DATA=/data NODE_ENV=production TZ=Europe/Warsaw
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
