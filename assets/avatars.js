export const avatars = [
 ['gamepad','🎮 ゲームパッド'],['star','⭐ スター'],['rocket','🚀 ロケット'],['puzzle','🧩 パズル'],['palette','🎨 パレット'],['lightning','⚡ ライトニング'],
 ['cat','🐱 ねこ'],['fox','🦊 きつね'],['panda','🐼 パンダ'],['dog','🐶 いぬ'],['rabbit','🐰 うさぎ'],['bear','🐻 くま'],['penguin','🐧 ペンギン'],['owl','🦉 ふくろう'],['frog','🐸 かえる'],['turtle','🐢 かめ'],['whale','🐳 くじら'],['octopus','🐙 たこ'],
 ['robot','🤖 ロボット'],['ghost','👻 おばけ'],['dragon','🐉 ドラゴン'],['alien','👽 エイリアン'],['crown','👑 王冠'],['gem','💎 宝石'],['moon','🌙 月'],['sun','☀️ 太陽'],['flower','🌸 花'],['clover','🍀 クローバー'],['tree','🌳 木'],['planet','🪐 惑星'],['icecream','🍦 アイス'],['pizza','🍕 ピザ'],['ball','⚽ ボール'],['dice','🎲 サイコロ'],['headphones','🎧 ヘッドホン'],['book','📚 本'],
];
export const avatarGlyph = key => avatars.find(([id]) => id === key)?.[1].split(' ')[0] ?? '🎮';
