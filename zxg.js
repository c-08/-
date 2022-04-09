/*
腾讯自选股V2

更新了一下脚本，精简了需要的CK，多账户用换行(\n)或者@或者#隔开，尽量用换行隔开因为我没测试其他
一天跑两次就够了，10点到13点之间运行一次猜涨跌做任务，16点半之后运行一次领猜涨跌奖励
提现设置：默认提现5元，需要改的话自己设置TxStockCash变量，0代表不提现，1代表提现1元，5代表提现5元
新手任务设置：默认不做新手任务，需要做的话设置TxStockNewbie为1
分享任务设置：默认会做互助任务，需要多账号，黑号也能完成分享任务。不想做的话设置TxStockHelp为0
可以设置某些号只助力别的号不做任务(没资格的小号可以助力大号)，在对应的ck后面加&task=0
没有捉到微信CK的也可以跑脚本，删掉wzq_qlskey和wzq_qluin就行，会尝试用APP的CK去完成微信任务，出现做任务失败是正常现象

青龙捉包，需要捉APP和公众号里面的小程序
1. 打开APP，捉wzq.tenpay.com包，把url里的openid和fskey用&连起来填到TxStockCookie
2. 公众号 腾讯自选股微信版->右下角好福利->福利中心，捉wzq.tenpay.com包，把Cookie里的wzq_qlskey和wzq_qluin用&连起来填到TxStockCookie
格式如下：
export TxStockCookie='openid=xx&fskey=yy&wzq_qlskey=zz&wzq_qluin=aa'

V2P，圈X重写：
打开APP和小程序自动获取
小程序入口：公众号 腾讯自选股微信版->右下角好福利->福利中心
[task_local]
#腾讯自选股
35 11,16 * * * https://raw.githubusercontent.com/c-08/-/main/zxg.js, tag=腾讯自选股, enabled=true
[rewrite_local]
https://wzq.tenpay.com/cgi-bin/.*user.*.fcgi url script-request-header https://raw.githubusercontent.com/c-08/-/main/zxg.js
[MITM]
hostname = wzq.tenpay.com
*/
const jsname = '腾讯自选股V2'
const $ = new Env(jsname);

const notifyFlag = 1; //0为关闭通知，1为打开通知,默认为1
let notifyStr = ''

let envSplitor = ['\n','@','#']
let httpResult //global buffer

let withdrawCash = ($.isNode() ? (process.env.TxStockCash) : ($.getval('TxStockCash'))) || 5; //0为不自动提现,1为自动提现1元,5为自动提现5元
let helpFlag = ($.isNode() ? (process.env.TxStockHelp) : ($.getval('TxStockHelp'))) || 1; //0为不做分享助力任务，1为多用户互相分享助力
let newbieFlag = ($.isNode() ? (process.env.TxStockNewbie) : ($.getval('TxStockNewbie'))) || 0; //0为不做新手任务，1为自动做新手任务
let userCookie = ($.isNode() ? process.env.TxStockCookie : $.getdata('TxStockCookie')) || '';
let userList = []

let userIdx = 0
let userCount = 0

let TASK_WAITTIME = 100
let BULL_WAITTIME = 5000

let test_taskList = []
let todayDate = formatDateTime();
let SCI_code = '000001' //上证指数
let marketCode = {'sz':0, 'sh':1, 'hk':2, }
let signType = {task:'home', sign:'signdone', award:'award'}

let taskList = {
    app: {
        daily: [1105, 1101, 1111, 1113],
        newbie: [1023, 1033],
        dailyShare: ["news_share", "task_50_1101", "task_51_1101", "task_50_1111", "task_51_1111", "task_51_1113", "task_72_1113", "task_74_1113", "task_75_1113", "task_76_1113"],
        newbieShare: [],
    },
    wx: {
        daily: [1100, 1110, 1112],
        newbie: [1032],
        dailyShare: ["task_50_1100", "task_51_1100", "task_50_1110", "task_51_1110", "task_66_1110", "task_51_1112", "task_75_1112"],
        newbieShare: ["task_50_1032", "task_51_1032", "task_50_1033", "task_51_1033"],
    },
}

let bullTaskArray = { 
    "rock_bullish":{"taskName":"戳牛任务", "action":"rock_bullish", "actid":1105}, 
    "open_box":{"taskName":"开宝箱", "action":"open_box", "actid":1105}, 
    "open_blindbox":{"taskName":"开盲盒", "action":"open_blindbox", "actid":1105}, 
    "query_blindbox":{"taskName":"查询皮肤数量", "action":"query_blindbox", "actid":1105},
    "sell_skin":{"taskName":"卖皮肤", "action":"sell_skin", "actid":1105},
    "feed":{"taskName":"喂长牛", "action":"feed", "actid":1105},
}

///////////////////////////////////////////////////////////////////
class UserInfo {
    constructor(str) {
        this.index = ++userIdx
        this.name = this.index
        this.canRun = true
        this.hasWxCookie = true
        this.valid = false
        this.coin = -1
        this.shareCodes = {task:{}, newbie:{}, bull:{}, guess:{}}
        this.bullStatusFlag = false
        
        let info = str2json(str)
        this.openid = info['openid'] || ''
        this.fskey = info['fskey'] || ''
        this.wzq_qlskey = info['wzq_qlskey'] || ''
        this.wzq_qluin = info['wzq_qluin'] || ''
        this.task = info['task'] || 1
        this.cookie = `wzq_qlskey=${this.wzq_qlskey}; wzq_qluin=${this.wzq_qluin}; zxg_openid=${this.openid};`
        
        let checkParam = ['openid','fskey','wzq_qlskey','wzq_qluin']
        let missEnv = []
        for(let param of checkParam) {
            if(!this[param]) missEnv.push(param);
        }
        if(missEnv.length > 0) {
            let missStr = missEnv.join(', ')
            let notiStr = `账号[${this.index}]缺少参数：${missStr}`
            if(missStr.indexOf('openid') > -1 || missStr.indexOf('fskey') > -1 ) {
                notiStr += '，无法运行脚本'
                this.canRun = false
            } else if(missStr.indexOf('wzq_qlskey') > -1 || missStr.indexOf('wzq_qluin') > -1) {
                notiStr += '，尝试用APP的CK去完成微信任务和助力，可能出现失败情况'
                this.hasWxCookie = false
            }
            console.log(notiStr)
        }
    }
    
    async getUserName() {
        try {
            let url = `https://proxy.finance.qq.com/group/newstockgroup/RssService/getSightByUser2?g_openid=${this.openid}&openid=${this.openid}&fskey=${this.fskey}`
            let body = `g_openid=${this.openid}&search_openid=${this.openid}`
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('post',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.code==0) {
                this.name = result.data.user_name
            } else {
                console.log(`账号[${this.name}]查询账户昵称失败: ${result.msg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async getUserInfo(isWithdraw=false) {
        try {
            let url = `https://wzq.tenpay.com/cgi-bin/shop.fcgi?action=home_v2&type=2&openid=${this.openid}&fskey=${this.fskey}&channel=1`
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.retcode==0) {
                this.valid = true
                let lastCoin = this.coin
                this.coin = result.shop_asset ? result.shop_asset.amount : 0
                if(lastCoin > -1) {
                    logAndNotify(`账号[${this.name}]金币余额：${this.coin}，本次运行共获得${this.coin-lastCoin}金币`)
                } else {
                    console.log(`账号[${this.name}]金币余额：${this.coin}`)
                }
                
                if(isWithdraw && withdrawCash > 0) {
                    if(result.cash && result.cash.length > 0) {
                        let cashStr = `${withdrawCash}元现金`
                        for(let cashItem of result.cash) {
                            if(cashItem.item_desc == cashStr){
                                if(parseInt(this.coin) >= parseInt(cashItem.coins)){
                                    logAndNotify(`账号[${this.name}]金币余额多于${cashItem.coins}，开始提现${cashStr}`);
                                    await $.wait(TASK_WAITTIME);
                                    await this.getWithdrawTicket(cashItem.item_id);
                                } else {
                                    console.log(`账号[${this.name}]金币余额不足${cashItem.coins}，不提现`);
                                }
                                break;
                            }
                        }
                    }
                }
            } else {
                console.log(`账号[${this.name}]查询账户余额失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async signTask(actid,action,ticket='') {
        try {
            let url = `https://wzq.tenpay.com/cgi-bin/activity_sign_task.fcgi?actid=${actid}&channel=1&action=${action}&openid=${this.openid}&fskey=${this.fskey}`
            if(action == signType.task) {
                url += `&type=welfare_sign`
            } else if(action == signType.sign) {
                url += `&date=${todayDate}`
            } else if (action == signType.award) {
                url += `&reward_ticket=${ticket}`
            }
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.retcode==0) {
                if(result.forbidden_code) {
                    console.log(`查询签到任务失败，可能已黑号: ${result.forbidden_reason}`)
                } else {
                    if(action == signType.task) {
                        console.log(`已连续签到${result.task_pkg.continue_sign_days}天，总签到天数${result.task_pkg.total_sign_days}天`)
                        for(let item of result.task_pkg.tasks) {
                            if(item.date == todayDate){
                                if(item.status == 0){
                                    //今天未签到，去签到
                                    await $.wait(TASK_WAITTIME);
                                    await this.signTask(actid,signType.sign);
                                } else {
                                    //今天已签到
                                    console.log(`今天已签到`);
                                }
                            }
                        }
                        if(result.lotto_chance > 0 && result.lotto_ticket) {
                            await $.wait(TASK_WAITTIME);
                            await this.signTask(actid,signType.award,result.lotto_ticket);
                        }
                    } else if(action == signType.sign) {
                        console.log(`签到获得${result.reward_desc}`);
                    } else if(action == signType.award) {
                        console.log(`领取连续签到奖励获得${result.reward_desc}`);
                    }
                }
            } else {
                console.log(`查询签到任务失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async guessHome() {
        try {
            let url = `https://zqact.tenpay.com/cgi-bin/guess_home.fcgi?channel=1&source=2&new_version=3&openid=${this.openid}&fskey=${this.fskey}`
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.retcode==0) {
                let curTime = new Date()
                let currentHour = curTime.getHours()
                let currentDay = curTime.getDay()
                let isGuessTime = ((currentHour < 13) && (currentHour > 9) && (currentDay < 6) && (currentDay > 0)) ? 1 : 0
                
                //上期猜上证指数奖励
                if(result.notice_info && result.notice_info[0]) {
                    if(result.notice_info[0].answer_status == 1) {
                        console.log(`上期猜上证指数涨跌回答正确，准备领取奖励...`)
                        await $.wait(TASK_WAITTIME);
                        await this.getGuessAward(result.notice_info[0].date)
                    } else {
                        console.log(`上期猜上证指数涨跌回答错误`)
                    }
                }
                
                //上期猜个股奖励
                if(result.stock_notice_info && result.stock_notice_info[0]) {
                    if(result.stock_notice_info[0].guess_correct == 1) {
                        console.log(`上期猜个股涨跌回答正确，准备领取奖励...`)
                        await $.wait(TASK_WAITTIME);
                        await this.getGuessStockAward(result.stock_notice_info[0].date)
                    } else {
                        console.log(`上期猜个股涨跌回答错误`)
                    }
                }
                
                if(isGuessTime) {
                    //猜上证指数
                    if((result.T_info && result.T_info[0] && result.T_info[0].user_answer == 0) || 
                       (result.T1_info && result.T1_info[0] && result.T1_info[0].user_answer == 0)) {
                        if(result.date_list) {
                            for(let item of result.date_list) {
                                if(item.status == 3 && item.date == todayDate) {
                                    await $.wait(TASK_WAITTIME);
                                    await this.getStockInfo(SCI_code,marketCode['sh'])
                                    await $.wait(TASK_WAITTIME);
                                    await this.guessRiseFall(this.guessOption)
                                }
                            }
                        }
                    } else {
                        console.log(`已竞猜当期上证指数涨跌`)
                    }
                    
                    //猜个股
                    if(result.recommend && result.recommend.length > 0) {
                        this.guessStockFlag = true
                        for(let item of result.recommend.sort(function(a,b){return Math.abs(b["zdf"])-Math.abs(a["zdf"])})) {
                            await $.wait(TASK_WAITTIME);
                            await this.guessStockStatus(item)
                            if(this.guessStockFlag==false) break;
                        }
                    }
                } else {
                    console.log(`脚本只会在10点到13点之间进行竞猜，当前为非竞猜时段`)
                }
                
                if(result.invite_info) {
                    this.shareCodes.guess = result.invite_info
                    console.log(`猜涨跌互助码获取成功`)
                }
            } else {
                console.log(`进入猜涨跌页面失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async getGuessAward(guessDate) {
        try {
            let url = `https://zqact.tenpay.com/cgi-bin/activity.fcgi?channel=1&activity=guess_new&guess_act_id=3&guess_date=${guessDate}&guess_reward_type=1&openid=${this.openid}&fskey=${this.fskey}`
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.retcode==0) {
                console.log(`猜中上证指数涨跌获得${result.reward_value}金币`);
            } else {
                console.log(`领取猜上证指数奖励失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async getGuessStockAward(guessDate) {
        try {
            let url = `https://zqact.tenpay.com/cgi-bin/activity/activity.fcgi?activity=guess_new&action=guess_stock_reward&guess_date=${guessDate}&channel=1&openid=${this.openid}&fskey=${this.fskey}`
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.retcode==0) {
                if(result.stock_rewards && result.stock_rewards.length > 0) {
                    for(let item of result.stock_rewards) {
                        console.log(`猜中个股[${item.stock_name}]涨跌获得${item.reward_desc}`);
                    }
                }
                console.log(`猜中个股涨跌总奖励${result.stock_reward_desc}`);
            } else {
                console.log(`领取猜个股奖励失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async getStockInfo(scode,markets) {
        try {
            let url = `https://zqact.tenpay.com/cgi-bin/open_stockinfo.fcgi?scode=${scode}&markets=${markets}&needfive=0&needquote=1&needfollow=0&type=0&channel=1&openid=${this.openid}&fskey=${this.fskey}`
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.body) {
                result = JSON.parse(result.body.replace(/\\x/g,''))
            }
            if(result.retcode==0) {
                let stockName = result.secu_info.secu_name || ''
                if(stockName) {
                    let dqj = result.secu_quote.dqj || 0
                    let zsj = result.secu_quote.zsj || 0
                    let raise = dqj - zsj
                    let ratio = raise/zsj*100
                    let guessStr = (raise < 0) ? '跌' : '涨'
                    this.guessOption = (raise < 0) ? 2 : 1
                    console.log(`${stockName}：当前价格${dqj}，前天收市价${zsj}，涨幅${Math.floor(ratio*100)/100}% (${Math.floor(raise*100)/100})，猜${guessStr}`);
                }
            } else {
                console.log(`获取股票涨跌信息失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async guessRiseFall(answer) {
        try {
            let url = `https://zqact.tenpay.com/cgi-bin/guess_op.fcgi?action=2&act_id=3&user_answer=${answer}&date=${todayDate}&channel=1&openid=${this.openid}&fskey=${this.fskey}`
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            let guessStr = (answer==1) ? "猜涨" : "猜跌"
            if(result.retcode==0) {
                console.log(`竞猜上证指数${guessStr}成功`)
            } else {
                console.log(`竞猜上证指数${guessStr}失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async guessStockRiseFall(stockItem,answer) {
        try {
            let url = `https://wzq.tenpay.com/cgi-bin/guess_op.fcgi?openid=${this.openid}&fskey=${this.fskey}&check=11`
            let body = `source=3&channel=1&outer_src=0&new_version=3&symbol=${stockItem.symbol}&date=${todayDate}&action=2&user_answer=${answer}&openid=${this.openid}&fskey=${this.fskey}&check=11`
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('post',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            let guessStr = (answer==1) ? "猜涨" : "猜跌"
            if(result.retcode==0) {
                console.log(`竞猜个股${guessStr}成功`)
            } else {
                console.log(`竞猜个股${guessStr}失败: ${result.retmsg}`)
            }
        } catch(e) {
            console.log(e)
        } finally {}
    }
    
    async guessStockStatus(stockItem) {
        try {
            let url = `https://wzq.tenpay.com/cgi-bin/guess_home.fcgi?openid=${this.openid}&fskey=${this.fskey}&check=11&source=3&channel=1&symbol=${stockItem.symbol}&new_version=3`
            let body = ``
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('get',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.retcode==0) {
                console.log(`剩余猜个股涨跌次数：${result.guess_times_left}`);
                if(result.guess_times_left > 0) {
                    if(result.T_info.user_
