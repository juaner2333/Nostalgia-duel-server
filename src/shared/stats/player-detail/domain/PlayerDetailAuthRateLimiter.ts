/**
 * 玩家详情密码验证失败次数限制端口
 */
export interface PlayerDetailAuthRateLimiter {
	/**
	 * 检查指定来源对目标玩家的密码验证失败次数是否已达到上限（60秒内最多5次）
	 * @param sourceIp 请求来源 IP
	 * @param normalizedUsername 规范化玩家昵称（去首尾空格后转小写）
	 * @returns true 表示已被限制（超出限制，应返回 429），false 表示未受限
	 */
	isLimited(sourceIp: string, normalizedUsername: string): Promise<boolean>;

	/**
	 * 记录一次密码验证失败
	 * @param sourceIp 请求来源 IP
	 * @param normalizedUsername 规范化玩家昵称
	 */
	recordFailure(sourceIp: string, normalizedUsername: string): Promise<void>;

	/**
	 * 验证成功后重置/清理该来源对该玩家的失败计数
	 * @param sourceIp 请求来源 IP
	 * @param normalizedUsername 规范化玩家昵称
	 */
	reset(sourceIp: string, normalizedUsername: string): Promise<void>;
}
