import express from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.json({
    message: "AI分析バックエンドが起動しています",
  });
});

app.post("/api/ai-analysis", async (req, res) => {
  try {
    const trades = req.body;

    const response = await openai.responses.create({
      model: "gpt-5.6-luna",

      input: `
      以下はユーザーのFX取引分析データです。
      ${JSON.stringify(trades, null, 2)}
      データには以下が含まれています。
      - summary：全体の集計結果
      - directionAnalysis：BUY / SELL別の分析
      - symbolAnalysis：銘柄別の分析
      - methodAnalysis：手法別の分析
      - trades：個別の取引データ
      これらのデータを使って、ユーザーの取引傾向を分析してください。
      特に以下を確認してください。
      
      1. 全体的な取引状況
      2. 勝ちやすかった条件
      3. 負けが発生した条件
      4. BUYとSELLの違い
      5. 銘柄ごとの特徴
      6. 手法ごとの特徴
      7. RRと結果の関係
      8. 保有時間と結果の関係
      9. データから確認できる改善ポイント

      必ず以下のJSON形式だけで回答してください。

      {
        "summary": "全体的な取引状況",
        "strengths": [
          "良かった特徴"
        ],
        "weaknesses": [
          "注意点"
        ],
        "improvements": [
          "改善ポイント"
        ]
      }

      JSON以外の文章は出力しないでください。

      重要：
      - summaryや各分析結果に含まれる数値は、基本的にそのまま使用する
      - データに存在しない数値を推測して作らない
      - 取引件数が少ない場合はデータ不足と明記する
      - 相関関係だけで因果関係があると断定しない
      `,
    });
    const analysis = JSON.parse(response.output_text);

    res.json({
      analysis,
    });
  } catch (error) {
    console.error("AI分析エラー:", error);
    res.status(500).json({
      error: "AI分析中にエラーが発生しました",
    });
  }
});

app.post("/api/ai-analysis-single", async (req, res) => {
  try {
    const trade = req.body;

    const response = await openai.responses.create({
      model: "gpt-5.6-luna",
      input: `
      以下はユーザーのFX取引分析データです。
      ${JSON.stringify(trade, null, 2)}
      この1件の取引について分析してください。

      特に以下を確認してください。

      1. 取引結果
      2. RRと損益
      3. エントリー条件
      4. TP / SL
      5. 保有時間
      6. BUY / SELL
      7. 根拠
      8. 良かった点
      9. 注意点
      10. 次回に向けた改善ポイント

      必ず以下のJSON形式だけで回答してください。

      {
        "summary": "この取引の総合的な分析",
        "goodPoints": [
          "良かった点"
        ],
        "cautions": [
          "注意点"
        ],
        "improvements": [
          "改善ポイント"
        ]
      }

      JSON以外の文章は出力しないでください。

      重要：
      - データに存在しない事実を作らない
      - チャートを見ていない場合、チャートから判断したような説明をしない
      - 1件だけの取引なので、一般的な傾向とは断定しない
      - 結果から将来の利益や勝率を予測しない
      - 投資判断や売買推奨をしない
      `,
    });

    const analysis = JSON.parse(response.output_text);

    res.json({
      analysis,
    });
  } catch (error) {
    console.error("AI分析エラー:", error);

    res.status(500).json({
      error: "AI分析中にエラーが発生しました",
    });
  }
});

const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Backend server started on port ${port}`);
});
