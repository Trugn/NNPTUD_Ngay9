var express = require("express");
var router = express.Router();
let messageModel = require('../schemas/messages');
let userModel = require('../schemas/users');
let { CheckLogin } = require('../utils/authHandler');

// GET / - Get last message from each user (conversations)
router.get('/', CheckLogin, async function (req, res, next) {
  try {
    const currentUserId = req.user._id;

    // Get all unique users that have conversations with current user
    const conversations = await messageModel.aggregate([
      {
        $match: {
          $or: [
            { from: currentUserId },
            { to: currentUserId }
          ],
          isDeleted: false
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$from", currentUserId] },
              "$to",
              "$from"
            ]
          },
          lastMessage: { $first: "$$ROOT" },
          lastMessageDate: { $first: "$createdAt" }
        }
      },
      {
        $sort: { lastMessageDate: -1 }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      {
        $unwind: {
          path: "$userInfo",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $match: {
          userInfo: { $ne: null }
        }
      },
      {
        $project: {
          _id: 1,
          lastMessage: 1,
          userInfo: {
            _id: 1,
            username: 1,
            fullName: 1,
            email: 1,
            avatarUrl: 1
          }
        }
      }
    ]);

    // Format the response - fix lỗi khi userInfo không tồn tại
    const formattedConversations = conversations
      .filter(conv => conv.userInfo && conv.userInfo._id)
      .map((conv) => ({
        conversationWith: {
          _id: conv.userInfo._id,
          username: conv.userInfo.username || "",
          fullName: conv.userInfo.fullName || "",
          email: conv.userInfo.email || "",
          avatarUrl: conv.userInfo.avatarUrl || "https://i.sstatic.net/l60Hf.png"
        },
        lastMessage: {
          _id: conv.lastMessage._id,
          from: conv.lastMessage.from,
          to: conv.lastMessage.to,
          messageContent: conv.lastMessage.messageContent,
          createdAt: conv.lastMessage.createdAt
        }
      }));

    res.status(200).send({
      success: true,
      data: formattedConversations,
      count: formattedConversations.length
    });
  } catch (error) {
    console.error("Lỗi trong GET /:", error);
    res.status(500).send({ message: "Lỗi server", error: error.message });
  }
});

// POST / - Create a new message
router.post('/', CheckLogin, async function (req, res, next) {
  try {
    const { to, messageContent } = req.body;
    const currentUserId = req.user._id;

    // Validate required fields
    if (!to || !messageContent) {
      return res.status(400).send({ message: "Thiếu thông tin: to hoặc messageContent" });
    }

    if (!messageContent.type || !messageContent.text) {
      return res.status(400).send({ message: "messageContent phải có type và text" });
    }

    if (!["text", "file"].includes(messageContent.type)) {
      return res.status(400).send({ message: "type phải là 'text' hoặc 'file'" });
    }

    // Validate if to is valid ObjectId
    if (!to.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).send({ message: "ID người nhận không hợp lệ" });
    }

    // Check if target user exists
    const targetUser = await userModel.findById(to);
    if (!targetUser) {
      return res.status(404).send({ message: "Người dùng nhận tin nhắn không tồn tại" });
    }

    // Prevent user from sending message to themselves
    if (currentUserId.toString() === to) {
      return res.status(400).send({ message: "Không thể gửi tin nhắn cho chính mình" });
    }

    // Create new message
    const newMessage = new messageModel({
      from: currentUserId,
      to: to,
      messageContent: {
        type: messageContent.type,
        text: messageContent.text
      }
    });

    const savedMessage = await newMessage.save();
    const populatedMessage = await messageModel.findById(savedMessage._id)
      .populate('from', 'username fullName email avatarUrl')
      .populate('to', 'username fullName email avatarUrl');

    res.status(201).send({
      success: true,
      message: "Gửi tin nhắn thành công",
      data: populatedMessage
    });
  } catch (error) {
    res.status(500).send({ message: "Lỗi server", error: error.message });
  }
});

// GET /:userID - Get all messages between current user and userID
router.get('/:userID', CheckLogin, async function (req, res, next) {
  try {
    const { userID } = req.params;
    const currentUserId = req.user._id;

    // Validate if userID is valid ObjectId
    if (!userID.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).send({ message: "ID người dùng không hợp lệ" });
    }

    // Check if user exists
    const targetUser = await userModel.findById(userID);
    if (!targetUser) {
      return res.status(404).send({ message: "Người dùng không tồn tại" });
    }

    // Get all messages between current user and target user
    const messages = await messageModel
      .find({
        $or: [
          { from: currentUserId, to: userID },
          { from: userID, to: currentUserId }
        ],
        isDeleted: false
      })
      .populate('from', 'username fullName email avatarUrl')
      .populate('to', 'username fullName email avatarUrl')
      .sort({ createdAt: 1 });

    res.status(200).send({
      success: true,
      data: messages,
      count: messages.length
    });
  } catch (error) {
    res.status(500).send({ message: "Lỗi server", error: error.message });
  }
});

module.exports = router;
