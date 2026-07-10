# Sentinel

Bot Discord dla spolecznosci National Devils. Po refaktorze glowny plik
`sentinel.js` tylko uruchamia aplikacje, a funkcje sa w modulach `src/features`.

## Szybkie wprowadzenie

Jesli przekazujesz ten projekt dalej, najprosciej myslec o nim tak:

1. `sentinel.js` uruchamia bota.
2. `src/config.js` zbiera ustawienia i sekrety.
3. `commands/` trzyma komendy wpisywane na Discordzie.
4. `src/features/` trzyma automatyczne funkcje bota.
5. Pliki `.json` i katalog `logs/` przechowuja stan bota i historie dzialania.

## Alerty mlodych kont

Gdy nowy czlonek dolaczy do serwera, bot sprawdza date utworzenia jego konta
Discord. Jesli konto jest mlodsze niz skonfigurowany prog, wysyla embed na kanal
aktywnosci serwerowej.

Najwazniejsze zmienne srodowiskowe:

- `NEW_ACCOUNT_ALERT_CHANNEL_ID` - kanal na alerty, domyslnie `1506378538113040414`.
- `NEW_ACCOUNT_ALERT_MAX_AGE_DAYS` - maksymalny wiek konta, domyslnie `30`.

## Promocje gier

Bot potrafi raz dziennie sprawdzac darmowe i mocno przecenione gry ze Steam
oraz Epic Games Store. Do konfiguracji uzyj komendy:

```bash
/promocje ustaw kanal:#promocje min_procent:80 limit:10
```

Reczne sprawdzenie:

```bash
/promocje sprawdz
```

Najwazniejsze zmienne srodowiskowe:

- `GAME_DEALS_CHANNEL_ID` - kanal na embedy z ofertami.
- `GAME_DEALS_MIN_DISCOUNT` - minimalna przecena dla platnych gier, domyslnie `80`.
- `GAME_DEALS_MAX_PRICE` - maksymalna cena po przecenie w CheapShark, domyslnie `60` USD.
- `GAME_DEALS_CRON` - harmonogram cron, domyslnie `0 10 * * *`.
- `GAME_DEALS_TIMEZONE` - strefa czasu harmonogramu, domyslnie `Europe/Warsaw`.
- `GAME_DEALS_MAX_POSTS_PER_RUN` - limit embedow na jedno sprawdzenie, domyslnie `10`.

## Statystyki Discorda

Bot zlicza aktywnosc tekstowa i kanaly glosowe bez zapisywania tresci wiadomosci. Dane sa
agregowane lokalnie w `discord_stats.json`, a nastepnie wysylane okresowo do
WordPressa przez endpoint pluginu `PPL Discord Stats`.

Na Discordzie dostepna jest komenda:

```bash
/aktywnosc serwer okres:7d
/aktywnosc top typ:Wiadomosci okres:30d
/aktywnosc user uzytkownik:@nick okres:7d
```

Widoki `/aktywnosc serwer`, `/aktywnosc top` i `/aktywnosc user` sa renderowane jako karta PNG,
zeby przypominaly zwarte tabelki Statbota.

Nazwy wyswietlane w komendach i na stronie sa nickami serwerowymi Discorda
(`displayName`), a nie globalnymi nazwami kont.

Wtyczka WP obsluguje m.in.:

- `[PPL_discord_stats period="7d"]` - pelny widok z rankingami, wykresami i aktualna aktywnoscia na kanalach glosowych.
- `[PPL_discord_wykresy period="30d"]` - same wykresy aktywnosci.
- `[PPL_discord_moje_stats period="30d"]` - profil zalogowanego uzytkownika po polaczeniu Discord -> WP.
- `[PPL_discord_voice_live]` - lista osob aktualnie na kanalach glosowych.

Najwazniejsze zmienne srodowiskowe:

- `WP_DISCORD_STATS_ENDPOINT` - endpoint z pluginu WP, np. `/wp-json/legion/v1/discord-stats`.
- `WP_DISCORD_STATS_TOKEN` - token pokazany w `Settings -> Discord Stats`.
- `DISCORD_STATS_SYNC_MS` - co ile wysylac podsumowanie do WP, domyslnie `60000`.
- `DISCORD_STATS_RETENTION_DAYS` - ile dni agregatow trzymac lokalnie, domyslnie `365`.
- `DISCORD_STATS_IGNORED_CHANNEL_IDS` - kanaly pominiete w statystykach, np. kanaly dobierania gry i AFK.
- `DISCORD_ENABLE_PRESENCE_INTENT=true` - wymagane do zliczania czasu w grach; Presence Intent musi byc wlaczony tez w Discord Developer Portal.

## Kurczaki PUBG LEGION

Bot sprawdza ostatnie mecze graczy z `listaklanu.json`, powiazan z
`bindings.json` oraz nickow z `klan.json`. Jesli ktorys klanowicz wygra mecz,
bot wysyla embed z grafika na kanal kurczakow. Pierwsze uruchomienie domyslnie
tylko zapisuje aktualne ostatnie mecze, zeby nie wyslac starych zwyciestw naraz.
Tagi klanow przy nickach sa pobierane z PUBG API na podstawie aktualnego
`clanId` gracza.

Najwazniejsze zmienne srodowiskowe:

- `PUBG_CHICKEN_CHANNEL_ID` - kanal na powiadomienia, domyslnie `1518343160382754816`.
- `PUBG_CHICKEN_CHECK_MS` - co ile sprawdzac mecze, domyslnie `120000`.
- `PUBG_CHICKEN_REQUEST_DELAY_MS` - przerwa miedzy zapytaniami PUBG API, domyslnie `7000`.
- `PUBG_CHICKEN_MAX_REQUESTS_PER_RUN` - maksymalna liczba zapytan w jednym cyklu, domyslnie `8`.
- `PUBG_CHICKEN_MATCH_LOOKBACK` - ile ostatnich meczow gracza sprawdzac, domyslnie `5`.
- `PUBG_CHICKEN_ANNOUNCE_ON_FIRST_RUN` - ustaw `true`, jesli pierwszy start ma wyslac juz znalezione wygrane.

## Start lokalny

```bash
npm ci
cp .env.production.example .env.production
nano .env.production
ENV_FILE=.env.production npm start
```

## Start w kontenerze

```bash
cp .env.production.example .env.production
cp .env.test.example .env.test
docker compose up -d --build
```

Domyslnie Docker Compose czyta `.env.production`. Jesli chcesz uruchomic wersje
testowa, uzyj:

```bash
ENV_FILE=.env.test docker compose up -d --build
```

Sekrety trzymaj w `.env.production` i `.env.test`, a stan bota w wolumenie `data/`.
Szczegoly sprzatania sa w `docs/CLEANUP.md`.

## Najwazniejsze pliki i foldery

### Pliki startowe i konfiguracyjne

- `README.md` - krotki opis projektu i instrukcja startu.
- `package.json` - lista bibliotek oraz komendy typu `npm start`.
- `package-lock.json` - dokladne wersje bibliotek; zwykle nie edytuje sie go recznie.
- `.env.production.example` - wzor konfiguracji dla produkcji.
- `.env.test.example` - wzor konfiguracji dla testow.
- `.env.production` - prawdziwe sekrety dla produkcji. Tego pliku nie wrzucamy na GitHub.
- `.env.test` - prawdziwe sekrety dla testow. Tego pliku nie wrzucamy na GitHub.
- `.env.example` - stary, ogolny wzor; zostal dla zgodnosci wstecznej.
- `docker-compose.yml` - najprostszy sposob uruchomienia bota na serwerze w Dockerze.
- `Dockerfile` - przepis, jak zbudowac obraz Dockera dla tego bota.
- `.dockerignore` - lista plikow, ktorych nie trzeba kopiowac do obrazu Dockera.
- `.gitignore` - lista plikow, ktorych nie chcemy wysylac do repozytorium.

### Glowny kod aplikacji

- `sentinel.js` - glowny punkt startowy. Sprawdza konfiguracje, tworzy klienta Discord i wlacza reszte modulow.
- `src/config.js` - centrum ustawien. Tu sa sciezki do plikow, ID kanalow i rol oraz dane do integracji.
- `src/client.js` - tworzy polaczenie z Discordem i ustawia, jakie typy zdarzen bot ma odbierac.
- `src/commandLoader.js` - laduje komendy slash z katalogu `commands/` i rejestruje je na serwerze Discord.
- `src/eventLoader.js` - laduje eventy z katalogu `events/`.
- `src/features/index.js` - wlacza wszystkie dodatkowe funkcje bota w jednym miejscu.
- `src/jsonStore.js` - prosty zapis i odczyt plikow JSON. To taka mala "pamiec" bota bez bazy danych.
- `src/logger.js` - zapisuje logi do plikow dzien po dniu.
- `src/pubgApi.js` - wspolny kod do polaczenia z PUBG API.

### Katalogi z logika bota

- `commands/` - kazdy plik to jedna komenda Discord, np. loteria, ticket, PUBG albo topka.
- `src/features/` - automatyczne funkcje bota, np. rangi PUBG, pokoje glosowe, tickety, YouTube, streamy i logi.
- `events/` - reakcje na wybrane zdarzenia Discorda, glownie zwiazane z wydarzeniami serwera.
- `klan/` - logika zwiazana z klanem: synchronizacja skladu, zapis danych i integracja z WordPressem.
- `utils/` - mniejsze pliki pomocnicze do integracji z zewnetrznymi uslugami.
- `assets/` - obrazki uzywane przez bota.
- `docs/` - dodatkowe notatki techniczne.

### Pliki z danymi bota

To nie jest kod. Te pliki trzymaja aktualny stan bota i czesto tworza sie albo zmieniaja same podczas dzialania.

- `bindings.json` - powiazania kont Discord z nickami PUBG.
- `loteria.json` - lista uczestnikow loterii.
- `streamers.json` - lista obserwowanych streamerow.
- `youtube.json` - ustawienia i zapis obserwowanych kanalow YouTube.
- `tickets.json` - licznik ticketow.
- `temporary_voice_config.json` - stan tymczasowych pokoi glosowych.
- `tempRoles.json` - dane o rolach tymczasowych.
- `season.json` - zapamietany sezon PUBG.
- `stats_cache.json` - zapis ostatnio pobranych statystyk PUBG, zeby nie pytac API za czesto.
- `clan_stats.json` - ostatni zapis poziomu i statystyk klanu.
- `klan.json` i `listaklanu.json` - dane potrzebne do listy i statystyk klanu.
- `rocznice.json` - zapis, komu bot juz naliczyl rocznice.
- `wulgaryzmy.txt` - lista zablokowanych slow, uzywana przy niektorych pokojach glosowych.
- `logs/` - dzienne logi dzialania bota.
- `google-service-account.json` - klucz do Google Sheets. To sekret i nie powinien trafic do publicznego repo.

### Co mozna zignorowac na start

- `Dzialajaca konfiguracja/` - kopie starszych, dzialajacych wersji.

## Uwaga praktyczna

Przy uruchomieniu w Dockerze dane bota sa trzymane glownie w `./data` i `./logs`
na hoscie. Przy uruchomieniu bez Dockera czesc plikow JSON moze lezec bezposrednio
w katalogu projektu, zalezne od ustawienia `DATA_DIR`.

Dla testow ustaw osobne ID serwera Discord, kanalow i rol. W przeciwnym razie bot
testowy moze probowac dzialac na ustawieniach produkcyjnych.
