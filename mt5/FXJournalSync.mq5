#property strict

input string ApiBaseUrl = "http://localhost:3001";
input string SyncToken = "";
input int PollSeconds = 5;
input int ServerUtcOffsetMinutes = 0; // MT5口座サーバー時刻のUTCとの差

string JsonEscape(string value) {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   return value;
}

string IsoTime(datetime serverTime) {
   datetime utc = serverTime - ServerUtcOffsetMinutes * 60;
   MqlDateTime parts;
   TimeToStruct(utc, parts);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", parts.year, parts.mon, parts.day, parts.hour, parts.min, parts.sec);
}

int CallApi(string method, string path, string body, char &result[]) {
   string headers = "Authorization: Bearer " + SyncToken + "\r\nContent-Type: application/json\r\n";
   char data[];
   StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(data) > 0) ArrayResize(data, ArraySize(data) - 1);
   string responseHeaders;
   ResetLastError();
   int status = WebRequest(method, ApiBaseUrl + path, headers, 10000, data, result, responseHeaders);
   if(status == -1) Print("FX Journal APIへの接続に失敗しました。MT5のWebRequest許可URLと接続先を確認してください。error=", GetLastError());
   else if(status < 200 || status >= 300) Print("FX Journal APIエラー: HTTP ", status, " ", CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
   return status;
}

string ExtractRequestId(string response) {
   int key = StringFind(response, "\"id\":\"");
   if(key < 0) return "";
   int start = key + 6;
   int finish = StringFind(response, "\"", start);
   return finish > start ? StringSubstr(response, start, finish - start) : "";
}

bool FindPositionEntry(ulong positionId, double &entryPrice, double &entryVolume, string &direction, datetime &entryTime, double &entryCommission, double &entryFee) {
   double weighted = 0.0;
   entryVolume = 0.0;
   entryCommission = 0.0;
   entryFee = 0.0;
   datetime earliest = D'3000.01.01';
   direction = "";
   for(int i = 0; i < HistoryDealsTotal(); i++) {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0 || (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID) != positionId) continue;
      long entryType = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entryType != DEAL_ENTRY_IN && entryType != DEAL_ENTRY_INOUT) continue;
      double volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      weighted += HistoryDealGetDouble(ticket, DEAL_PRICE) * volume;
      entryVolume += volume;
      if(HistoryDealGetInteger(ticket, DEAL_TYPE) == DEAL_TYPE_BUY) direction = "BUY";
      else if(HistoryDealGetInteger(ticket, DEAL_TYPE) == DEAL_TYPE_SELL) direction = "SELL";
      datetime when = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      if(when < earliest) earliest = when;
      entryCommission += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      entryFee += HistoryDealGetDouble(ticket, DEAL_FEE);
   }
   if(entryVolume <= 0.0) return false;
   entryPrice = weighted / entryVolume;
   entryTime = earliest;
   return direction != "";
}

void Synchronize(string requestId) {
   if(!HistorySelect(0, TimeCurrent())) {
      Print("MT5取引履歴を読み取れませんでした。");
      return;
   }
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string account = AccountInfoString(ACCOUNT_SERVER) + ":" + IntegerToString(login);
   string dealsJson = "[";
   int skipped = 0;
   bool first = true;
   for(int i = 0; i < HistoryDealsTotal(); i++) {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      long entryType = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_OUT_BY) { if(entryType == DEAL_ENTRY_INOUT) skipped++; continue; }
      ulong positionId = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      double entryPrice, entryVolume, entryCommission, entryFee;
      string direction;
      datetime entryTime;
      if(!FindPositionEntry(positionId, entryPrice, entryVolume, direction, entryTime, entryCommission, entryFee)) { skipped++; continue; }
      string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      double closeVolume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double ratio = entryVolume > 0.0 ? closeVolume / entryVolume : 1.0;
      double commission = HistoryDealGetDouble(ticket, DEAL_COMMISSION) + entryCommission * ratio;
      double fee = HistoryDealGetDouble(ticket, DEAL_FEE) + entryFee * ratio;
      string item = StringFormat("{\"ticket\":\"%I64u\",\"positionId\":\"%I64u\",\"symbol\":\"%s\",\"direction\":\"%s\",\"volume\":%.8f,\"entryPrice\":%.10f,\"exitPrice\":%.10f,\"entryTime\":\"%s\",\"exitTime\":\"%s\",\"profit\":%.8f,\"commission\":%.8f,\"swap\":%.8f,\"fee\":%.8f,\"accountCurrency\":\"%s\"}", ticket, positionId, JsonEscape(symbol), direction, closeVolume, entryPrice, HistoryDealGetDouble(ticket, DEAL_PRICE), IsoTime(entryTime), IsoTime((datetime)HistoryDealGetInteger(ticket, DEAL_TIME)), HistoryDealGetDouble(ticket, DEAL_PROFIT), commission, HistoryDealGetDouble(ticket, DEAL_SWAP), fee, JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)));
      if(!first) dealsJson += ",";
      dealsJson += item;
      first = false;
   }
   dealsJson += "]";
   string body = "{\"account\":\"" + JsonEscape(account) + "\",\"skipped\":" + IntegerToString(skipped) + ",\"deals\":" + dealsJson + "}";
   char result[];
   int status = CallApi("POST", "/api/mt5/sync-requests/" + requestId + "/deals", body, result);
   if(status >= 200 && status < 300) Print("FX Journal同期完了。スキップしたMT5反転取引など: ", skipped);
}

void OnTimer() {
   if(StringLen(SyncToken) < 20) return;
   char result[];
   if(CallApi("GET", "/api/mt5/pending", "", result) != 200) return;
   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   string requestId = ExtractRequestId(response);
   if(requestId != "") Synchronize(requestId);
}

int OnInit() {
   EventSetTimer(PollSeconds < 2 ? 2 : PollSeconds);
   Print("FX Journal同期EAを開始しました。MT5のツール > オプション > エキスパートアドバイザ > WebRequest許可URLへAPI URLを追加してください: ", ApiBaseUrl);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }
