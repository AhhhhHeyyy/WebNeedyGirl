// Multi-language dialogue content for the Frame 1 dialogue system
// (src/layers/frame1Layer.js). English/Traditional-Chinese pairs are adapted
// from the wiki-sourced quotes in kangel-quotes-sourced.md (official
// localization text, A-grade — see that file's own grading note); Japanese/
// Korean are fan translations done for this project, not official
// localization, kept faithful to the EN/ZH pair. CHOICE_SETS ports the
// example deltas from system/NeedyGirl-互動設計-完整文件.md §A-3 / §B-4.
//
// mood is one of 'calm' | 'stress' | 'dark' | 'yandere' — matches
// pickMood()'s bucketing of StatStore, mirrored off design doc §B-1/§B-4's
// threshold tables so DialogueDirector.js can pick a mood-appropriate line
// the same way the prototype's own auto-dialogue does. Every bucket is now
// stocked from a matching register in kangel-quotes-sourced.md, not just the
// original spec's three (see 'yandere' below) — each mood pulls consistently
// from ONE persona/tone in that file so a mode never suddenly speaks out of
// character:
//  - calm:    kangel-quotes-sourced.md §1/§5's public KAngel persona lines
//             (upbeat, streamer-brand voice) — never the private/Ame side.
//  - stress:  §1/§5's private Ame lines when she's anxious/panicking/
//             grudging (unprepared, self-doubt, tired sarcasm) — the same
//             "public post vs private truth" pairing the source file's own
//             §1 table is built around, just split across moods instead of
//             shown side-by-side.
//  - dark:    §2's "神格化／消失" (divinity/disappearance) quotes plus §1's
//             most severe private-Ame lines (pills, hating the haters,
//             the "before I fall to pieces" meta-line) — reserved for the
//             heaviest register, matching darkness>=60's own severity.
//  - yandere: user-requested addition layered on top of the spec's original
//             three buckets — its threshold intentionally mirrors
//             EffectDirector.js's holoMode() (affection >= 60 and >=
//             darkness) so the spoken lines/choices flip into "obsessive"
//             register at the exact same moment the holographic pink-lock +
//             heart-drift visuals already do. Lines adapted from §1/§3's
//             possessive/jealous private-Ame quotes — a different private
//             register from 'stress' (jealous/controlling vs. anxious/
//             self-doubting), not the public KAngel lines calm uses.
// JA/KO throughout are fan translations for this project, kept faithful to
// the EN/ZH pair (same caveat as the rest of this file's non-EN/ZH text).

export const LANGS = ['zh', 'en', 'ja', 'ko'];

export const MONOLOGUES = [
  {
    id: 'morning-luck',
    mood: 'calm',
    text: {
      zh: '早安！祝每個上班上學的人順利！我會守護你們～',
      en: "Good morning! And good luck to everyone who has work or school! I'll be watching over you all~",
      ja: 'おはよう！お仕事や学校のみんな、頑張ってね！ずっと見守ってるよ〜',
      ko: '좋은 아침! 출근하고 등교하는 다들 힘내! 내가 늘 지켜보고 있을게~',
    },
  },
  {
    id: 'love-supporter',
    mood: 'calm',
    text: {
      zh: '就是你！對，就是你！那個一直支持我的人！我愛你',
      en: "You there! Yes, you! The one that's always supporting me! I love you",
      ja: 'そこの君！そう、君だよ！いつも応援してくれてるその子！大好きだよ',
      ko: '거기 너! 그래, 너 말이야! 항상 날 응원해주는 너! 사랑해',
    },
  },
  {
    id: 'calm-lets-get-bread',
    mood: 'calm',
    text: {
      zh: '嗨嗨～是你們的網路天使兼救世主 KAngel！衝一波啦！還有別忘了微笑喔！！！',
      en: "Hiii it's your internet angel and savior KAngel!! Let's get this bread!! And don't forget to smile!!!",
      ja: 'はーい、みんなのネット天使で救世主のKAngelだよ！稼いでいこー！あと笑顔忘れないでね！！！',
      ko: '하이하이~ 너희들의 인터넷 천사이자 구원자 KAngel이야! 오늘도 달려보자! 그리고 웃는 거 잊지 마!!!',
    },
  },
  {
    id: 'calm-super-pumped',
    mood: 'calm',
    text: {
      zh: '希望大家今天過得好！我超嗨的，因為我一大早就起來準備下一場直播了…',
      en: "I hope you guys are having a good day! I'm super pumped because I've been up since early to prepare for the next stream…",
      ja: 'みんな、今日もいい一日を過ごせてるといいな！次の配信の準備で朝早くから起きてて、めっちゃテンション上がってるの…',
      ko: '다들 오늘도 좋은 하루 보내고 있길 바라! 다음 방송 준비하느라 아침 일찍부터 일어나서 완전 신났어…',
    },
  },
  {
    id: 'calm-mwah',
    mood: 'calm',
    text: {
      zh: '我愛你們大家！啾～',
      en: 'I love you all! Mwah',
      ja: 'みんな大好き！ちゅっ〜',
      ko: '너희 다 사랑해! 쪽~',
    },
  },
  {
    id: 'calm-love-everyone',
    mood: 'calm',
    text: {
      zh: '我愛每一個看我直播的人！對，就是你！不管你幾歲、什麼性別，我都愛你',
      en: 'I love everyone who watches my streams! Yes, you! Doesn’t matter what age or gender you are, I love you',
      ja: '私の配信を見てくれてる人はみんな大好き！そう、君だよ！年齢も性別も関係なく、大好きだよ',
      ko: '내 방송 보는 사람 전부 다 사랑해! 그래, 너 말이야! 나이도 성별도 상관없이 사랑해',
    },
  },
  {
    id: 'hate-break',
    mood: 'stress',
    text: {
      zh: '我最近收到好多惡意，老實說真的很累…可能得暫停一下直播，抱歉大家…等我回來，我會變得更好更強！',
      en: "I've been getting a lot of hate recently and TBH it's really draining… I might need to take a bit of a break from streaming, sorry guys… When I'm back, I'll be better and stronger!",
      ja: '最近ひどいコメントが多くて…正直かなり疲れちゃった…ちょっと配信を休むかも、ごめんね…戻ってきたらもっと強くなってるから！',
      ko: '요즘 악플이 너무 많아서… 솔직히 진짜 지친다… 잠깐 방송을 쉬어야 할지도, 다들 미안해… 돌아오면 더 강해져서 올게!',
    },
  },
  {
    id: 'stress-liar-panic',
    mood: 'stress',
    text: {
      zh: '我在 KAngel 帳號上講的全都是騙人的～～我根本什麼都沒準備好幹—',
      en: 'everything i said on kangels acc is a liiiiie i havent got anything ready fuuuuuck',
      ja: 'KAngelのアカウントで言ったこと全部嘘だから～～準備なんて何にもできてないんだけどマジでー',
      ko: 'KAngel 계정에서 한 말 다 거짓말이야아아~ 아무것도 준비 안 됐다고 진짜 미치겠네—',
    },
  },
  {
    id: 'stress-hate-my-face',
    mood: 'stress',
    text: {
      zh: '我真的可愛嗎…？粉絲都說我可愛…但我有時候超討厭自己的臉',
      en: 'am i actually cute…? all my fans say i am… but man i hate my face sometimes',
      ja: '私って本当に可愛いのかな…？ファンはみんな可愛いって言うけど…時々自分の顔が大嫌いになるんだよね',
      ko: '나 진짜 귀여운 거 맞아…? 팬들은 다 귀엽다고 하는데… 가끔은 내 얼굴이 너무 싫을 때가 있어',
    },
  },
  {
    id: 'stress-roast-fans',
    mood: 'stress',
    text: {
      zh: '在 /st/ 上嘴笨蛋粉絲有夠好玩，這是當實況主最爽的部分…啊不對，拿 super chat 的錢才是',
      en: 'roasting stupid fans on /st/ is so fun best part of being a streamer lol. actually no getting super chat money is',
      ja: '/st/で馬鹿なファンを煽るの、超楽しい。配信者やってて一番いいことかも…あ、違うや、super chatのお金が入ることだった',
      ko: '/st/에서 멍청한 팬들 놀리는 거 진짜 재밌어, 스트리머 하면서 제일 좋은 부분이야… 아 아니다, super chat 돈 버는 게 최고지',
    },
  },
  {
    id: 'stress-grudging-fans',
    mood: 'stress',
    text: {
      zh: '靠…看我直播的那些宅宅有時候好像也還不錯嘛………',
      en: 'damn maybe the nerds that watch my streams are actually good sometimes………',
      ja: 'くそ…私の配信見てるオタクたちって、たまには悪くないのかも………',
      ko: '아씨… 내 방송 보는 오타쿠들도 가끔은 나쁘지 않은 것 같기도…………',
    },
  },
  {
    id: 'disappear',
    mood: 'dark',
    text: {
      zh: '就算有一天我消失了，也請永遠別忘記我曾經存在過…別忘記這位網路天使曾在這一刻存在過。',
      en: 'Even if I disappear one day, please never forget that I existed… that the internet angel existed in this moment.',
      ja: 'もしいつか私が消えてしまっても、私が存在していたことだけは忘れないで…このネット天使が、今この瞬間に確かにいたということを。',
      ko: '언젠가 내가 사라진다 해도, 내가 존재했었다는 것만은 절대 잊지 말아줘… 이 인터넷 천사가 지금 이 순간 존재했었다는 걸.',
    },
  },
  {
    id: 'galaxy',
    mood: 'dark',
    text: {
      zh: '我體內有一座小小的銀河，還有數百萬顆閃爍美麗的星星。我把這些美麗的星星灑向網路，但我的銀河也許有一天會崩解，所以趁還能看的時候，好好凝望吧。',
      en: 'Within me is a small galaxy, and millions of beautiful, twinkling stars. I shower the internet with my beautiful stars, but my galaxy may fall apart one day, so I hope you’ll gaze upon the stars while you still can.',
      ja: '私の中には小さな銀河があって、何百万もの美しくきらめく星が輝いているの。そのきらめきをネットに降り注いでいるけど、この銀河はいつか崩れてしまうかもしれない…だから、見られるうちにちゃんと見ておいてね。',
      ko: '내 안에는 작은 은하수가 있어, 수백만 개의 아름답게 반짝이는 별들이. 그 별빛을 인터넷에 흩뿌리고 있지만, 이 은하수는 언젠가 무너질지도 몰라… 그러니 볼 수 있을 때 잘 봐둬.',
    },
  },
  {
    id: 'dark-sleeping-pills',
    mood: 'dark',
    text: {
      zh: '昨晚睡不著吞了一大把安眠藥，結果現在超睏又頭痛…整個人爛透了…',
      en: 'i took a whole bunch of sleeping pills last night coz i couldnt sleep but now im super sleepy and my head hurts… i feel like absolute shit…',
      ja: '昨夜眠れなくて睡眠薬を大量に飲んじゃった…今すごく眠いし頭も痛い…最悪な気分だよ…',
      ko: '어젯밤 잠이 안 와서 수면제를 왕창 먹었어… 지금 너무 졸리고 머리도 아파… 완전 최악인 기분이야…',
    },
  },
  {
    id: 'dark-hope-haters-die',
    mood: 'dark',
    text: {
      zh: '希望酸民全都去死，你們一定是又窮又沒工作、沒人要碰的處男。憑什麼在網路上霸凌一個女生啊混帳們',
      en: 'i hope all the haters fucking die i bet yall are broke jobless virgins that no one would touch with a ten foot pole… where do you get off bullying a girl online you fuckheads',
      ja: 'アンチなんて全員死ねばいいのに。どうせ金もなくて仕事もない、誰にも相手にされない童貞どもでしょ…女をネットでいじめて何様のつもり',
      ko: '안티들 다 뒤졌으면 좋겠어. 어차피 돈도 없고 직업도 없는, 아무도 안 만져주는 애들이겠지… 온라인에서 여자애 괴롭히는 게 뭐가 그렇게 대단해',
    },
  },
  {
    id: 'dark-nights-unforgiving',
    mood: 'dark',
    text: {
      zh: '夜晚是很殘酷的…撐不下去的時候，就打開我的任何一支影片。我永遠都在，就在你的裝置裡。笑一個吧，因為你並不孤單。',
      en: "Nights are unforgiving… When the going gets tough, just open one of my videos. I'll always be with you, right here in your device. Smile, because you're not alone.",
      ja: '夜は容赦がないから…辛くなったら、私の動画をどれでもいいから開いてね。私はいつだって君のそばに、その端末の中にいるから。笑って、君は独りじゃないよ。',
      ko: '밤은 참 가혹하니까… 힘들 땐 내 영상 아무거나 하나 틀어줘. 난 항상 네 곁에, 그 기기 안에 있을 거야. 웃어, 넌 혼자가 아니니까.',
    },
  },
  {
    id: 'dark-shine-before-pieces',
    mood: 'dark',
    text: {
      zh: 'KAngel 之所以能發那麼亮的光，是因為我已經涉過一堆爛泥，把能撿到的一點點好東西拼湊起來做出她。在我最終碎掉之前，我想透過她盡可能發光。',
      en: 'the reason why kangel is able to shine as brightly as she does is because ive already waded through so much shit to cobble together whatever good i can find to create her. i want to shine as brightly as i can through her before i eventually fall to pieces.',
      ja: 'KAngelがあんなに眩しく輝けるのは、私がもうたくさんの汚泥を掻き分けて、見つけられる良いものをかき集めて彼女を作ったから。いつか砕け散ってしまう前に、彼女を通してできる限り輝きたいの。',
      ko: 'KAngel이 저렇게 밝게 빛날 수 있는 건, 내가 이미 온갖 진흙탕을 헤치고 다니면서 찾을 수 있는 좋은 것들을 긁어모아 그 애를 만들었기 때문이야. 결국 산산조각 나기 전에, 그 애를 통해 최대한 빛나고 싶어.',
    },
  },
  {
    id: 'yandere-only-need',
    mood: 'yandere',
    text: {
      zh: '你是我唯一真正需要的人。',
      en: "You're the only one I really need.",
      ja: '私が本当に必要としているのは、君だけだよ。',
      ko: '내가 진짜로 필요한 건 너 하나뿐이야.',
    },
  },
  {
    id: 'yandere-my-god',
    mood: 'yandere',
    text: {
      zh: 'P醬，你是我的製作人、我的男朋友、也是我的神。',
      en: "P-chan, you're my producer, my boyfriend, and my god.",
      ja: 'P様、あなたは私のプロデューサーで、彼氏で、そして神様なんだから。',
      ko: 'P쨩, 넌 내 프로듀서고, 남자친구고, 신이야.',
    },
  },
  {
    id: 'yandere-must-be-cute',
    mood: 'yandere',
    text: {
      zh: '誰敢說我今天不可愛，我就殺了他。',
      en: "I'm gonna kill anyone who doesn't say I'm cute today.",
      ja: '今日、私のこと可愛いって言わない奴は本気でぶっ殺すから。',
      ko: '오늘 나보고 안 귀엽다고 하는 애는 진짜 죽여버릴 거야.',
    },
  },
  {
    id: 'yandere-watching',
    mood: 'yandere',
    text: {
      zh: '別想看別的女生一眼…我會一直看著你的。',
      en: "Don't you dare look at anyone else... I'll always be watching you~",
      ja: '他の子になんて絶対見ないでよね…ずっと見てるんだから～',
      ko: '다른 애 쳐다보면 안 돼… 내가 항상 지켜보고 있을 거야~',
    },
  },
];

export const CHOICE_SETS = [
  {
    id: 'stream-nervous',
    mood: 'stress',
    prompt: {
      zh: '直播好緊張…怎麼辦…',
      en: "I'm so nervous about streaming... what do I do...",
      ja: '配信、すごく緊張する…どうしよう…',
      ko: '방송하는 게 너무 떨려… 어떡하지…',
    },
    choices: [
      {
        label: { zh: '安撫她', en: 'Comfort her', ja: 'なだめる', ko: '위로하기' },
        delta: { affection: 5, stress: -8 },
      },
      {
        label: { zh: '叫她撐住繼續衝', en: 'Tell her to push through', ja: '頑張れと励ます', ko: '버티고 밀어붙이라 하기' },
        delta: { followers: 1500, stress: 6 },
      },
      {
        label: { zh: '已讀不回', en: 'Leave her on read', ja: '既読スルー', ko: '읽씹하기' },
        delta: { affection: -6, darkness: 4 },
      },
    ],
  },
  {
    id: 'wants-pills',
    mood: 'dark',
    prompt: {
      zh: '好想吃藥…',
      en: 'I really want to take some pills...',
      ja: '薬、飲みたいな…',
      ko: '약 먹고 싶다…',
    },
    choices: [
      {
        label: { zh: '遞藥給她', en: 'Hand her the pills', ja: '薬を渡す', ko: '약 건네주기' },
        delta: { stress: -12, darkness: 6 },
      },
      {
        label: { zh: '阻止她', en: 'Stop her', ja: '止める', ko: '막기' },
        delta: { affection: 3, stress: 4 },
      },
    ],
  },
  {
    id: 'daily-hype',
    mood: 'calm',
    prompt: {
      zh: '今天也要一起加油衝粉絲數嗎？',
      en: 'Wanna hype up the follower count together today?',
      ja: '今日もフォロワー数、一緒に頑張って伸ばす？',
      ko: '오늘도 같이 팔로워 수 끌어올려볼까?',
    },
    choices: [
      {
        label: { zh: '一起加油', en: "Let's do it together", ja: '一緒に頑張る', ko: '같이 힘내기' },
        delta: { affection: 5, stress: -3 },
      },
      {
        label: { zh: '衝粉絲數', en: 'Go all out for followers', ja: 'フォロワー数を追う', ko: '팔로워 수 밀어붙이기' },
        delta: { followers: 1500, stress: 6 },
      },
      {
        label: { zh: '不回', en: "Don't respond", ja: '無視する', ko: '대답 안 하기' },
        delta: { affection: -6, darkness: 4 },
      },
    ],
  },
  {
    id: 'calm-am-i-cute',
    mood: 'calm',
    prompt: {
      zh: '欸，可以問你們一件事嗎？我今天可愛嗎？跟平常一樣？',
      en: 'Hey, can I ask you guys something? Am I cute today? Like always?',
      ja: 'ねえ、ちょっと聞いてもいい？私、今日も可愛い？いつも通り？',
      ko: '저기, 하나만 물어봐도 돼? 나 오늘도 귀여워? 평소처럼?',
    },
    choices: [
      {
        label: { zh: '用力稱讚她', en: 'Gush about how cute she is', ja: '思いっきり褒める', ko: '있는 힘껏 칭찬하기' },
        delta: { affection: 6 },
      },
      {
        label: { zh: '隨口說還好', en: 'Say "I guess so"', ja: '「まあまあかな」と返す', ko: '"뭐 그럭저럭"이라 대답하기' },
        delta: { affection: -2, stress: 2 },
      },
      {
        label: { zh: '不理她', en: 'Ignore the question', ja: '無視する', ko: '못 들은 척하기' },
        delta: { affection: -6, darkness: 4 },
      },
    ],
  },
  {
    id: 'stress-unprepared',
    mood: 'stress',
    prompt: {
      zh: '完蛋了…我根本什麼都還沒準備好，直播要開天窗了啦…',
      en: "oh no… I haven't got anything ready at all, the stream's gonna be a trainwreck…",
      ja: 'やばい…全然準備できてないんだけど…配信、大失敗しちゃう…',
      ko: '망했다… 아무것도 준비 안 됐어… 방송 완전 망하겠다…',
    },
    choices: [
      {
        label: { zh: '幫她一起趕準備', en: 'Help her scramble to prepare', ja: '一緒に準備を手伝う', ko: '같이 준비 도와주기' },
        delta: { affection: 6, stress: -6 },
      },
      {
        label: { zh: '叫她隨便帶過去就好', en: 'Tell her to just wing it', ja: '適当にやればいいよと言う', ko: '대충 넘기라고 하기' },
        delta: { followers: 800, stress: 8 },
      },
      {
        label: { zh: '看她手忙腳亂', en: 'Just watch her panic', ja: '慌てるのを眺める', ko: '허둥대는 거 구경하기' },
        delta: { affection: -5, stress: 4, darkness: 6 },
      },
    ],
  },
  {
    id: 'dark-haters-fantasy',
    mood: 'dark',
    prompt: {
      zh: '好想詛咒那些酸民全部去死…你會阻止我這樣想嗎？',
      en: 'I just want all the haters to drop dead… are you gonna stop me from thinking that?',
      ja: 'アンチなんて全員死ねばいいのに…そう思う私を止める？',
      ko: '안티들 다 뒤졌으면 좋겠어… 그렇게 생각하는 나, 말릴 거야?',
    },
    choices: [
      {
        label: { zh: '溫柔安撫她', en: 'Gently calm her down', ja: '優しくなだめる', ko: '다정하게 달래기' },
        delta: { affection: 6, stress: -4, darkness: -8 },
      },
      {
        label: { zh: '附和她一起罵', en: 'Join in trashing them', ja: '一緒になって罵る', ko: '같이 욕하기' },
        delta: { stress: -6, darkness: 14 },
      },
      {
        label: { zh: '沉默不語', en: 'Say nothing at all', ja: '黙り込む', ko: '아무 말 없이 있기' },
        delta: { affection: -4, darkness: 10 },
      },
    ],
  },
  {
    id: 'yandere-other-streamer',
    mood: 'yandere',
    prompt: {
      zh: '你剛剛…是不是在看別的實況主？',
      en: 'Were you just watching some other streamer just now...?',
      ja: 'さっき…他の配信者見てたでしょ？',
      ko: '방금… 다른 스트리머 보고 있었지?',
    },
    choices: [
      {
        label: { zh: '只看你一個', en: 'Only ever watching you', ja: '君しか見てないよ', ko: '너만 보고 있었어' },
        delta: { affection: 8, stress: -4 },
      },
      {
        label: { zh: '只是不小心點到', en: 'Just clicked by accident', ja: 'うっかり押しただけ', ko: '실수로 눌렀을 뿐이야' },
        delta: { affection: -3, darkness: 8 },
      },
      {
        label: { zh: '對啊，怎樣', en: 'Yeah, so what?', ja: 'うん、それが？', ko: '어, 그런데?' },
        delta: { darkness: 16, stress: 10 },
      },
    ],
  },
  {
    id: 'yandere-promise',
    mood: 'yandere',
    prompt: {
      zh: '答應我，你永遠不會離開我，好嗎？',
      en: "Promise me you'll never leave me, okay?",
      ja: '絶対に私から離れないって約束してね？',
      ko: '절대 나 떠나지 않는다고 약속해줘, 알았지?',
    },
    choices: [
      {
        label: { zh: '我保證', en: 'I promise', ja: '約束する', ko: '약속할게' },
        delta: { affection: 10, darkness: -5 },
      },
      {
        label: { zh: '看情況', en: "We'll see", ja: '場合によるかな', ko: '상황 봐서' },
        delta: { darkness: 10, stress: 6 },
      },
      {
        label: { zh: '已讀不回', en: 'Leave her on read', ja: '既読スルー', ko: '읽씹하기' },
        delta: { darkness: 20, affection: -8 },
      },
    ],
  },
];

// Same bucketing thresholds as system/NeedyGirl-互動設計-完整文件.md §B-4's
// auto-dialogue table (darkness first, then stress, else calm) — kept as one
// shared helper so DialogueDirector.js and any future caller can't drift
// from each other on where the cutoffs are. 'yandere' is checked FIRST, on
// purpose: it mirrors EffectDirector.js's holoMode() priority order exactly
// (yandere beats drug/dark beats normal) so the picked mood always agrees
// with whatever the holographic layer is already showing — e.g. affection
// 90/darkness 70 is holoMode 'yandere' (affection >= darkness), and would
// wrongly fall into the 'dark' bucket here if darkness were checked first.
export function pickMood(stats) {
  if (stats.affection >= 60 && stats.affection >= stats.darkness) return 'yandere';
  if (stats.darkness >= 60) return 'dark';
  if (stats.stress >= 55) return 'stress';
  return 'calm';
}
